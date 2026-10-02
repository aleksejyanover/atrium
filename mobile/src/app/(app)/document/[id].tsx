import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, Empty, Field } from '@/components/controls';
import { ContractText } from '@/components/contract-text';
import { SavedSignatureCard, savedSignaturePayload } from '@/components/saved-signature';
import { SignaturePad } from '@/components/signature-pad';
import { AuthGuard, ScreenHeader } from '@/components/screen';
import { dismissalsApi } from '@/lib/endpoints';
import { formatDate } from '@/lib/format';
import { dismissalStatusLabel, statusColor } from '@/lib/status';
import { Stroke, strokesToSignatureDataUrl } from '@/lib/signature';
import { colors, radius } from '@/lib/theme';
import { ContractDocument } from '@/lib/types';
import { useAuth } from '@/state/auth';
import { useOrgs } from '@/state/orgs';
import { useToast } from '@/state/toast';

export default function DocumentRoute() {
  return (
    <AuthGuard>
      <DocumentScreen />
    </AuthGuard>
  );
}

function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { show } = useToast();
  const { user } = useAuth();
  const { documents, refreshMine } = useOrgs();

  const [signedName, setSignedName] = useState(user?.fullName ?? '');
  const [appliedSaved, setAppliedSaved] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [padSize, setPadSize] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshMine();
    }, [refreshMine]),
  );

  const item = documents.find((entry) => entry.document.id === id) ?? null;
  const document: ContractDocument | null = item?.document ?? null;

  const saved = savedSignaturePayload(user);
  const savedName = user?.fullName?.trim() ?? '';
  const pending = document?.status === 'pending';
  const targetId = document?.targetUserId ?? '';
  const isTarget = !!user && targetId === user.id;

  const canSign =
    !busy &&
    pending &&
    isTarget &&
    signedName.trim().length >= 2 &&
    (appliedSaved ? saved !== null : strokes.length > 0);

  const applySaved = () => {
    if (!saved) return;
    if (savedName) setSignedName(savedName);
    setAppliedSaved(true);
    setStrokes([]);
  };

  const sign = () => {
    if (!document || !canSign) return;
    Alert.alert(
      'Подписать и уволиться?',
      `ФИО: «${signedName.trim()}»\nПодписание расторгает членство в организации.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Подписать',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const signatureDataUrl = appliedSaved
                ? saved?.signatureDataUrl
                : strokesToSignatureDataUrl(strokes, padSize.w || 320, padSize.h || 210);
              if (!signatureDataUrl) return;
              setBusy(true);
              try {
                await dismissalsApi.sign(document.id, {
                  signatureDataUrl,
                  signatureText: appliedSaved ? saved?.signatureText : undefined,
                  signedName: signedName.trim(),
                });
                await refreshMine();
                show('Договор подписан');
                router.back();
              } catch (e) {
                Alert.alert('Подписание', e instanceof Error ? e.message : 'Ошибка');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  const reject = () => {
    if (!document || !pending || !isTarget) return;
    Alert.alert(
      'Оспорить договор?',
      'Членство сохранится — увольнение будет оспорено.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Оспорить',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await dismissalsApi.reject(document.id);
                await refreshMine();
                show('Договор оспорен');
                router.back();
              } catch (e) {
                Alert.alert('Оспаривание', e instanceof Error ? e.message : 'Ошибка');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  if (!document || !item) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Документ" onBack={() => router.back()} />
        <View style={styles.center}>
          <Empty text="Документ не найден" />
          <Button title="Назад" variant="ghost" onPress={() => router.back()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Договор об увольнении"
        subtitle={item.org.name}
        onBack={() => router.back()}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.metaCard}>
            <Avatar name={item.org.name} color={colors.accent} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.orgName} numberOfLines={1}>
                {item.org.name}
              </Text>
              <Text style={styles.metaSub}>Создан {formatDate(document.createdAt)}</Text>
            </View>
            <View style={styles.statusWrap}>
              <View style={[styles.statusDot, { backgroundColor: statusColor(document.status) }]} />
              <Text style={[styles.statusText, { color: statusColor(document.status) }]}>
                {dismissalStatusLabel(document.status)}
              </Text>
            </View>
          </View>

          <ContractText text={document.contractText} title="Договор об увольнении" />

          {pending && isTarget ? (
            <>
              <SavedSignatureCard
                user={user}
                applied={appliedSaved}
                onApply={applySaved}
                onClear={() => setAppliedSaved(false)}
                onProfile={() => router.push('/profile')}
              />

              <Field
                label="ФИО"
                value={signedName}
                onChangeText={setSignedName}
                placeholder="Иванов Иван Иванович"
                maxLength={120}
              />

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

              <View style={styles.actions}>
                <Button
                  title="Подписать и уволиться"
                  variant="danger"
                  disabled={!canSign}
                  loading={busy}
                  onPress={sign}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Оспорить"
                  variant="ghost"
                  disabled={busy || !pending}
                  onPress={reject}
                  style={{ flex: 1 }}
                />
              </View>

              <Text style={styles.finalNote}>
                Подписание окончательно: членство в организации будет прекращено. «Оспорить»
                сохраняет членство.
              </Text>
            </>
          ) : null}

          {!pending ? (
            <View style={styles.resolvedBox}>
              <Text style={styles.resolvedText}>
                {dismissalStatusLabel(document.status)}
                {document.signedAt ? ` · подписан ${formatDate(document.signedAt)}` : ''}
              </Text>
              {document.signedName ? (
                <Text style={styles.resolvedMeta}>ФИО: {document.signedName}</Text>
              ) : null}
            </View>
          ) : null}

          {pending && !isTarget ? (
            <Text style={styles.hint}>Ожидает подписи участника</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
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
  content: {
    padding: 16,
    gap: 18,
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
  orgName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  metaSub: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  statusWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
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
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  finalNote: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  resolvedBox: {
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    gap: 4,
  },
  resolvedText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  resolvedMeta: {
    color: colors.muted,
    fontSize: 12,
  },
});
