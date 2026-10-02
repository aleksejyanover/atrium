import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { AuthGuard, ScreenHeader } from '@/components/screen';
import { ActivityTab } from '@/components/org/activity-tab';
import { ApplicationsTab } from '@/components/org/applications-tab';
import { ChatsTab } from '@/components/org/chats-tab';
import { FinanceTab } from '@/components/org/finance-tab';
import { InvitesTab } from '@/components/org/invites-tab';
import { MembersTab } from '@/components/org/members-tab';
import { Button, Field } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { applicationsApi, chatApi, dismissalsApi, invitesApi, orgsApi } from '@/lib/endpoints';
import { pluralizeMembers } from '@/lib/format';
import {
  canCreateChannel,
  canEditOrg,
  canReviewApplications,
  canReviewDismissals,
  canViewOrgInvites,
} from '@/lib/roles';
import { colors, radius } from '@/lib/theme';
import {
  DMItem,
  IncomingInvite,
  Invite,
  OrgApplicationItem,
  OrgDetail,
  OrgDismissalItem,
} from '@/lib/types';
import { useAuth } from '@/state/auth';
import { useSocketEvent } from '@/state/socket';
import { useToast } from '@/state/toast';

type TabKey = 'chats' | 'members' | 'invites' | 'activity' | 'applications' | 'finance';

export default function OrgRoute() {
  return (
    <AuthGuard>
      <OrgScreen />
    </AuthGuard>
  );
}

function OrgScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { show } = useToast();

  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [dms, setDms] = useState<DMItem[]>([]);
  const [incoming, setIncoming] = useState<IncomingInvite[]>([]);
  const [outgoing, setOutgoing] = useState<Invite[]>([]);
  const [applications, setApplications] = useState<OrgApplicationItem[]>([]);
  const [dismissals, setDismissals] = useState<OrgDismissalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('chats');

  // --- настройки организации (rank ≥ 60) ---
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsName, setSettingsName] = useState('');
  const [settingsDescription, setSettingsDescription] = useState('');
  const [settingsPublic, setSettingsPublic] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const orgDetail = await orgsApi.get(id);
      setDetail(orgDetail);
      setError(null);
      const [dmsRes, incomingRes] = await Promise.all([chatApi.dms(), invitesApi.mine()]);
      setDms(dmsRes.dms.filter((dm) => dm.org?.id === id));
      setIncoming(incomingRes.invites);

      if (canViewOrgInvites(orgDetail.role)) {
        const outgoingRes = await orgsApi.invites(id);
        setOutgoing(outgoingRes.invites);
      } else {
        setOutgoing([]);
      }

      if (canReviewApplications(orgDetail.role)) {
        try {
          const appsRes = await applicationsApi.orgList(id);
          setApplications(appsRes.applications ?? []);
        } catch {
          setApplications([]);
        }
      } else {
        setApplications([]);
      }

      if (canReviewDismissals(orgDetail.role)) {
        try {
          const disRes = await dismissalsApi.orgList(id);
          setDismissals(disRes.documents ?? []);
        } catch {
          setDismissals([]);
        }
      } else {
        setDismissals([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось открыть организацию');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // keep the org screen fresh when something changes elsewhere
  useSocketEvent('channel:created', (payload) => {
    if (payload.orgId === id) void refresh();
  });
  useSocketEvent('member:joined', (payload) => {
    if (payload.orgId === id) void refresh();
  });
  useSocketEvent('member:left', (payload) => {
    if (payload.orgId === id) void refresh();
  });
  useSocketEvent('role:changed', (payload) => {
    if (payload.orgId === id) void refresh();
  });
  // SPEC v2 §13: заявления/документы обновляются в реальном времени.
  useSocketEvent('application:new', (payload) => {
    if (payload.application?.orgId === id || payload.org?.id === id) void refresh();
  });
  useSocketEvent('application:update', (payload) => {
    if (payload.application?.orgId === id || payload.org?.id === id) void refresh();
  });
  useSocketEvent('document:new', (payload) => {
    if (payload.document?.orgId === id || payload.org?.id === id) void refresh();
  });
  useSocketEvent('document:update', (payload) => {
    if (payload.document?.orgId === id || payload.org?.id === id) void refresh();
  });
  useSocketEvent('invite:new', (payload) => {
    void refresh();
    show(`Приглашение в организацию «${payload.org?.name ?? ''}»`, {
      onPress: () => router.push(`/contract/${payload.invite.id}`),
    });
  });

  const openChat = useCallback(
    (channelId: string) => {
      router.push(`/chat/${channelId}`);
    },
    [router],
  );

  const leave = useCallback(() => {
    router.replace('/');
  }, [router]);

  const openSettings = () => {
    if (!detail) return;
    setSettingsName(detail.org.name);
    setSettingsDescription(detail.org.description ?? '');
    setSettingsPublic(detail.org.isPublic !== false);
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    if (!detail || !id) return;
    const name = settingsName.trim();
    if (name.length < 2) {
      show('Название: не менее 2 символов');
      return;
    }
    setSavingSettings(true);
    try {
      await orgsApi.update(id, {
        name,
        description: settingsDescription.trim(),
        isPublic: settingsPublic,
      });
      setSettingsOpen(false);
      show('Организация обновлена');
      await refresh();
    } catch (e) {
      show(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading && !detail) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Организация" onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Организация" onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.error}>{error ?? 'Не удалось открыть организацию'}</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backLink}>Назад</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const editable = canEditOrg(detail.role);
  const showApplications = canReviewApplications(detail.role);

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'chats', label: 'Чаты' },
    { key: 'members', label: 'Участники' },
    { key: 'invites', label: 'Приглашения', badge: outgoing.length },
    { key: 'activity', label: 'История' },
    { key: 'finance', label: 'Финансы' },
    ...(showApplications
      ? [
          {
            key: 'applications' as TabKey,
            label: 'Заявления',
            badge: detail.pendingApplications ?? 0,
          },
        ]
      : []),
  ];

  const activeTab: TabKey = tabs.some((t) => t.key === tab) ? tab : 'chats';

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={detail.org.name}
        subtitle={
          detail.org.description
            ? `${pluralizeMembers(detail.org.membersCount)} · ${detail.org.description}`
            : pluralizeMembers(detail.org.membersCount)
        }
        onBack={() => router.back()}
        right={
          editable ? (
            <Pressable onPress={openSettings} hitSlop={8} style={styles.headerButton}>
              <Text style={styles.headerButtonText}>Настройки</Text>
            </Pressable>
          ) : undefined
        }
      />

      <View style={styles.tabBar}>
        {tabs.map((t) => {
          const active = activeTab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, active && styles.tabActive]}>
              <Text
                style={[styles.tabLabel, active && styles.tabLabelActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}>
                {t.label}
              </Text>
              {t.badge ? (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{t.badge > 9 ? '9+' : t.badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1 }}>
        {activeTab === 'chats' ? (
          <ChatsTab
            orgId={detail.org.id}
            channels={detail.channels}
            dms={dms}
            canCreate={canCreateChannel(detail.role)}
            onOpen={openChat}
            onRefresh={refresh}
            onChannelCreated={() => void refresh()}
          />
        ) : null}

        {activeTab === 'members' ? (
          <MembersTab
            orgId={detail.org.id}
            members={detail.members}
            actorRole={detail.role}
            meId={user?.id ?? ''}
            dismissals={dismissals}
            onOpenDm={openChat}
            onMembersChanged={refresh}
            onLeave={leave}
          />
        ) : null}

        {activeTab === 'invites' ? (
          <InvitesTab
            orgId={detail.org.id}
            actorRole={detail.role}
            meId={user?.id ?? ''}
            incoming={incoming}
            outgoing={outgoing}
            onOpenContract={(inviteId) => router.push(`/contract/${inviteId}`)}
            onChanged={refresh}
          />
        ) : null}

        {activeTab === 'activity' ? <ActivityTab orgId={detail.org.id} /> : null}

        {activeTab === 'finance' ? (
          <FinanceTab orgId={detail.org.id} members={detail.members} meId={user?.id ?? ''} />
        ) : null}

        {activeTab === 'applications' ? (
          <ApplicationsTab items={applications} onChanged={refresh} />
        ) : null}
      </View>

      <AppModal
        visible={settingsOpen}
        title="Настройки организации"
        onClose={() => setSettingsOpen(false)}
        footer={
          <Button
            title="Сохранить"
            loading={savingSettings}
            onPress={() => void saveSettings()}
          />
        }>
        <Field
          label="Название"
          value={settingsName}
          onChangeText={setSettingsName}
          maxLength={80}
        />
        <Field
          label="Описание"
          value={settingsDescription}
          onChangeText={setSettingsDescription}
          placeholder="О чём организация"
          maxLength={200}
          multiline
        />
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Публичная организация</Text>
            <Text style={styles.switchHint}>Видна в каталоге — к ней можно подать заявление</Text>
          </View>
          <Switch
            value={settingsPublic}
            onValueChange={setSettingsPublic}
            trackColor={{ false: colors.border, true: 'rgba(124,108,246,0.5)' }}
            thumbColor={settingsPublic ? colors.accent : colors.muted}
          />
        </View>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
  },
  backLink: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: '600',
  },
  headerButton: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
  },
  headerButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.panel,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 6,
    gap: 2,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    borderRadius: radius.sm,
    minWidth: 0,
  },
  tabActive: {
    borderBottomColor: colors.accent,
  },
  tabLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  tabLabelActive: {
    color: colors.text,
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  switchLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  switchHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
});
