import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { Button, Field } from '@/components/controls';
import { ContractText } from '@/components/contract-text';
import { SavedSignatureCard, savedSignaturePayload } from '@/components/saved-signature';
import { SignaturePad } from '@/components/signature-pad';
import { AuthGuard, ScreenHeader } from '@/components/screen';
import { joinContractText } from '@/lib/contract';
import { applicationsApi, discoverApi } from '@/lib/endpoints';
import { ROLE_LABELS } from '@/lib/roles';
import { Stroke, strokesToSignatureDataUrl } from '@/lib/signature';
import { colors, radius } from '@/lib/theme';
import { useAuth } from '@/state/auth';
import { useOrgs } from '@/state/orgs';
import { useToast } from '@/state/toast';

const MAX_MESSAGE = 500;

export default function ApplyRoute() {
  return (
    <AuthGuard>
      <ApplyScreen />
    </AuthGuard>
  );
}

function ApplyScreen() {
  const { orgId, name } = useLocalSearchParams<{ orgId: string; name?: string }>();
  const router = useRouter();
  const { show } = useToast();
  const { user } = useAuth();
  const { refreshMine } = useOrgs();

  const [orgName, setOrgName] = useState(typeof name === 'string' ? name : '');
  const [message, setMessage] = useState('');
  const [signedName, setSignedName] = useState(user?.fullName ?? '');
  const [appliedSaved, setAppliedSaved] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [padSize, setPadSize] = useState({ w: 0, h: 0 });
  const [submitting, setSubmitting] = useState(false);
  const resolvedRef = useRef(false);

  // Org name for the contract preview (deep link may not carry it).
  useEffect(() => {
    if (resolvedRef.current || !orgId) return;
    if (orgName) {
      resolvedRef.current = true;
      return;
    }
    let cancelled = false;
    discoverApi
      .search('')
      .then((res) => {
        if (cancelled) return;
        const found = res.orgs.find((org) => org.id === orgId);
        if (found) {
          resolvedRef.current = true;
          setOrgName(found.name);
        }
      })
      .catch(() => {
        // preview falls back to a generic title below
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, orgName]);

  const saved = savedSignaturePayload(user);
  const contractText = joinContractText(orgName || 'организацией', ROLE_LABELS.member);
  const savedName = user?.fullName?.trim() ?? '';

  const canSubmit =
    !submitting &&
    signedName.trim().length >= 2 &&
    (appliedSaved ? saved !== null : strokes.length > 0);

  const applySaved = () => {
    if (!saved) return;
    if (savedName) setSignedName(savedName);
    setAppliedSaved(true);
    setStrokes([]);
  };

  const clearSaved = () => setAppliedSaved(false);

  const doSubmit = async () => {
    if (!orgId || !canSubmit) return;
    // Сохранённая подпись — всегда dataUrl из профила; иначе рисуем от руки.
    const signatureDataUrl = appliedSaved
      ? saved?.signatureDataUrl
      : strokesToSignatureDataUrl(strokes, padSize.w || 320, padSize.h || 210);
    const signatureText = appliedSaved ? saved?.signatureText : undefined;
    if (!signatureDataUrl) return;
    setSubmitting(true);
    try {
      await applicationsApi.submit(orgId, {
        message: message.trim() ? message.trim() : undefined,
        signatureDataUrl,
        signatureText,
        signedName: signedName.trim(),
      });
      await refreshMine();
      show('Заявление отправлено');
      router.back();
    } catch (e) {
      Alert.alert('Заявление', e instanceof Error ? e.message : 'Не удалось отправить');
      setSubmitting(false);
    }
  };

  const confirmSubmit = () => {
    Alert.alert(
      'Подать заявление?',
      `ФИО: «${signedName.trim()}»\nОрганизация: «${orgName || '—'}»`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Подать', onPress: () => void doSubmit() },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Подать заявление"
        subtitle={orgName || 'Организация'}
        onBack={() => router.back()}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          {orgName ? (
            <View style={styles.orgCard}>
              <Avatar name={orgName} color={colors.accent} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.orgName} numberOfLines={1}>
                  {orgName}
                </Text>
                <Text style={styles.orgMeta}>Заявление на вступление</Text>
              </View>
            </View>
          ) : (
            <View style={styles.orgCard}>
              <Avatar name="?" color={colors.muted} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.orgName}>Организация</Text>
                <Text style={styles.orgMeta}>Заявление на вступление</Text>
              </View>
            </View>
          )}

          <Field
            label="Сообщение (необязательно)"
            value={message}
            onChangeText={setMessage}
            placeholder="Почему вы хотите присоединиться"
            maxLength={MAX_MESSAGE}
            multiline
          />

          <ContractText text={contractText} title="Договор о присоединении" />

          <SavedSignatureCard
            user={user}
            applied={appliedSaved}
            onApply={applySaved}
            onClear={clearSaved}
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

          <Text style={styles.finalNote}>
            Подпись и ФИО будут переданы организации. Отправку можно отозвать до принятия
            решения.
          </Text>

          <Button
            title="Подать заявление"
            disabled={!canSubmit}
            loading={submitting}
            onPress={confirmSubmit}
          />
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
  content: {
    padding: 16,
    gap: 18,
    paddingBottom: 48,
  },
  orgCard: {
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
  orgMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
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
