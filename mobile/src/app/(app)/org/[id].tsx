import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { AuthGuard, ScreenHeader } from '@/components/screen';
import { ChatsTab } from '@/components/org/chats-tab';
import { InvitesTab } from '@/components/org/invites-tab';
import { MembersTab } from '@/components/org/members-tab';
import { chatApi, invitesApi, orgsApi } from '@/lib/endpoints';
import { pluralizeMembers } from '@/lib/format';
import { canCreateChannel, canViewOrgInvites } from '@/lib/roles';
import { colors, radius } from '@/lib/theme';
import { DMItem, IncomingInvite, Invite, OrgDetail } from '@/lib/types';
import { useAuth } from '@/state/auth';
import { useSocketEvent } from '@/state/socket';
import { useToast } from '@/state/toast';

type TabKey = 'chats' | 'members' | 'invites';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('chats');

  const refresh = useCallback(async () => {
    if (!id) return;
    try {
      const orgDetail = await orgsApi.get(id);
      setDetail(orgDetail);
      setError(null);
      const [dmsRes, incomingRes] = await Promise.all([chatApi.dms(), invitesApi.mine()]);
      setDms(dmsRes.dms.filter((dm) => dm.org.id === id));
      setIncoming(incomingRes.invites);
      if (canViewOrgInvites(orgDetail.role)) {
        const outgoingRes = await orgsApi.invites(id);
        setOutgoing(outgoingRes.invites);
      } else {
        setOutgoing([]);
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

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'chats', label: 'Чаты' },
    { key: 'members', label: 'Участники' },
    { key: 'invites', label: 'Приглашения', badge: outgoing.length },
  ];

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
      />

      <View style={styles.tabBar}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tab, active && styles.tabActive]}>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
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
        {tab === 'chats' ? (
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

        {tab === 'members' ? (
          <MembersTab
            orgId={detail.org.id}
            members={detail.members}
            actorRole={detail.role}
            meId={user?.id ?? ''}
            onOpenDm={openChat}
            onMembersChanged={refresh}
            onLeave={leave}
          />
        ) : null}

        {tab === 'invites' ? (
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
      </View>
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
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.panel,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 8,
    gap: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    borderRadius: radius.sm,
  },
  tabActive: {
    borderBottomColor: colors.accent,
  },
  tabLabel: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
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
});
