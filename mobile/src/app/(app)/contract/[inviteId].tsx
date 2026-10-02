import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RoleBadge } from '@/components/avatar';
import { Button, Field } from '@/components/controls';
import { ContractText } from '@/components/contract-text';
import { SavedSignatureCard, savedSignaturePayload } from '@/components/saved-signature';
import { SignaturePad } from '@/components/signature-pad';
import { AuthGuard, ScreenHeader } from '@/components/screen';
import { invitesApi } from '@/lib/endpoints';
import { formatDate } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/roles';
import { unwrapUser } from '@/lib/socket-events';
import { strokesToSignatureDataUrl, Stroke } from '@/lib/signature';
import { colors, radius } from '@/lib/theme';
import { IncomingInvite, Role } from '@/lib/types';
import { useAuth } from '@/state/auth';
import { useOrgs } from '@/state/orgs';
import { useToast } from '@/state/toast';

export default function ContractRoute() {
  return (
    <AuthGuard>
      <ContractScreen />
    </AuthGuard>
  );
}

function ContractScreen() {
  const { inviteId } = useLocalSearchParams<{ inviteId: string }>();
  const router = useRouter();
  const { show } = useToast();
  const { user } = useAuth();
  const { refresh: refreshOrgs } = useOrgs();

  const [invite, setInvite] = useState<IncomingInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [signedName, setSignedName] = useState(user?.fullName ?? '');
  const [appliedSaved, setAppliedSaved] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [padSize, setPadSize] = useState({ w: 0, h: 0 });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await invitesApi.mine();
      const found = res.invites.find((item) => item.invite.id === inviteId) ?? null;
      setInvite(found);
      setError(found ? null : 'Приглашение не найдено или уже использовано');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить приглашение');
    } finally {
      setLoading(false);
    }
  }, [inviteId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const orgName = invite?.org.name ?? '';
  const role: Role = invite ? invite.role ?? invite.invite.role : 'member';
  const contractText = invite?.contractText ?? invite?.invite.contractText ?? '';
  const saved = savedSignaturePayload(user);
  const canSubmit =
    !submitting &&
    signedName.trim().length >= 2 &&
    (appliedSaved ? saved !== null : strokes.length > 0) &&
    invite !== null;

  const applySaved = () => {
    if (!saved) return;
    const fullName = user?.fullName?.trim();
    if (fullName) setSignedName(fullName);
    setAppliedSaved(true);
    setStrokes([]);
  };

  const doSubmit = async () => {
    if (!invite || !canSubmit) return;
    setSubmitting(true);
    try {
      // No canvas in React Native → strokes are serialized to an SVG document
      // and sent as data:image/svg+xml;base64,... (the API only requires the
      // value to start with "data:image/").
      const signatureDataUrl = appliedSaved
        ? saved?.signatureDataUrl
        : strokesToSignatureDataUrl(strokes, padSize.w || 320, padSize.h || 210);
      if (!signatureDataUrl) throw new Error('Подпись не подписана');
      await invitesApi.accept(invite.invite.id, {
        signatureDataUrl,
        signatureText: appliedSaved ? saved?.signatureText : undefined,
        signedName: signedName.trim(),
      });
      await refreshOrgs(); // refresh the org list
      show(`Вы вступили в организацию «${orgName}»`);
      router.replace('/');
    } catch (e) {
      Alert.alert('Подписание', e instanceof Error ? e.message : 'Не удалось подписать');
      setSubmitting(false);
    }
  };

  const confirmSubmit = () => {
    Alert.alert(
      'Подписать договор?',
      `ФИО: «${signedName.trim()}»\nОрганизация: «${orgName}»\nРоль: ${ROLE_LABELS[role] ?? role}\n\nПодписание окончательно.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Подписать', onPress: () => void doSubmit() },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Договор" onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  if (error || !invite) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Договор" onBack={() => router.back()} />
        <View style={styles.center}>
          <Text style={styles.error}>{error ?? 'Приглашение не найдено'}</Text>
          <Button title="Назад" variant="ghost" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Договор о присоединении"
        subtitle={orgName}
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <View style={styles.metaCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.metaTitle} numberOfLines={1}>
              {orgName}
            </Text>
            <Text style={styles.metaSub}>
              от @{unwrapUser(invite.inviter)?.username ?? '—'} · {formatDate(invite.createdAt)}
            </Text>
          </View>
          <RoleBadge role={role} />
        </View>

        <ContractText text={contractText} title="Договор о присоединении" />

        <SavedSignatureCard
          user={user}
          applied={appliedSaved}
          onApply={applySaved}
          onClear={() => setAppliedSaved(false)}
          onProfile={() => router.push('/profile')}
        />

        <View style={{ gap: 8 }}>
          <Text style={styles.label}>ФИО</Text>
          <Field
            value={signedName}
            onChangeText={setSignedName}
            placeholder="Введите ФИО как в документе"
            maxLength={120}
          />
        </View>

        {!appliedSaved ? (
          <View style={{ gap: 8 }}>
            <View style={styles.signHeader}>
              <Text style={styles.label}>Подпись</Text>
              <Button
                title="Очистить"
                variant="ghost"
                small
                disabled={strokes.length === 0}
                onPress={() => setStrokes([])}
              />
            </View>
            <SignaturePad
              strokes={strokes}
              onChange={setStrokes}
              onSize={(w, h) => setPadSize({ w, h })}
            />
            <Text style={styles.hint}>Распишитесь здесь пальцем или стилусом</Text>
          </View>
        ) : null}

        <Text style={styles.finalNote}>
          Подпись и ФИО будут переданы организации. Подписание окончательно.
        </Text>

        <Button
          title="Подписать и вступить"
          disabled={!canSubmit}
          loading={submitting}
          onPress={confirmSubmit}
        />
      </ScrollView>
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
  content: {
    padding: 16,
    gap: 20,
    paddingBottom: 48,
  },
  metaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
  },
  metaTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  metaSub: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  contract: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
  },
  contractLine: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  signHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
  },
  finalNote: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
});
