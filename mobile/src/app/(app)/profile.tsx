import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, OwnerBadge } from '@/components/avatar';
import { Button, Empty, Field } from '@/components/controls';
import { OwnerCard } from '@/components/owner-card';
import { SignaturePad } from '@/components/signature-pad';
import { SignaturePreview } from '@/components/signature-preview';
import { AuthGuard, ScreenHeader } from '@/components/screen';
import { meApi, ownerApi } from '@/lib/endpoints';
import { formatBalance } from '@/lib/format';
import {
  Stroke,
  strokesToSignatureDataUrl,
  typedSignatureDataUrl,
} from '@/lib/signature';
import { CAVEAT_FONT, colors, radius } from '@/lib/theme';
import { SignatureKind } from '@/lib/types';
import { useAuth } from '@/state/auth';
import { useToast } from '@/state/toast';

type SignatureMode = 'none' | 'text' | 'draw';

export default function ProfileRoute() {
  return (
    <AuthGuard>
      <ProfileScreen />
    </AuthGuard>
  );
}

function ProfileScreen() {
  const router = useRouter();
  const { user, updateMe, refreshMe, logout } = useAuth();
  const { show } = useToast();

  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [mode, setMode] = useState<SignatureMode>('none');
  const [typedText, setTypedText] = useState('');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [padSize, setPadSize] = useState({ w: 0, h: 0 });
  const [savingSignature, setSavingSignature] = useState(false);

  const [ownerCode, setOwnerCode] = useState('');
  const [claiming, setClaiming] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void refreshMe();
    }, [refreshMe]),
  );

  const saveProfile = async () => {
    const name = displayName.trim();
    const nameValue = user?.displayName ?? '';
    const nextFullName = fullName.trim();
    const prevFullName = user?.fullName ?? '';
    if (name.length < 2) {
      Alert.alert('Профиль', 'Отображаемое имя: не менее 2 символов');
      return;
    }
    if (nextFullName && nextFullName.length < 2) {
      Alert.alert('Профиль', 'ФИО: не менее 2 символов');
      return;
    }
    if (name === nameValue && nextFullName === prevFullName) return;
    setSavingProfile(true);
    try {
      const res = await meApi.update({ displayName: name, fullName: nextFullName });
      updateMe(res.user);
      show('Профиль сохранён');
    } catch (e) {
      Alert.alert('Профиль', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    if (!currentPassword || newPassword.length < 6) {
      Alert.alert('Смена пароля', 'Укажите текущий пароль и новый (не менее 6 символов)');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await meApi.update({ currentPassword, password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      updateMe(res.user);
      show('Пароль изменён');
    } catch (e) {
      Alert.alert('Смена пароля', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSavingPassword(false);
    }
  };

  /** Активация карточки владельца — POST /api/owner/claim (SPEC v5 §29). */
  const claimOwner = async () => {
    const code = ownerCode.trim();
    if (!code) {
      Alert.alert('Карточка владельца', 'Введите код владельца');
      return;
    }
    setClaiming(true);
    try {
      await ownerApi.claim(code);
      setOwnerCode('');
      show('👑 Карточка владельца активирована');
      await refreshMe();
    } catch (e) {
      Alert.alert('Карточка владельца', e instanceof Error ? e.message : 'Неверный код');
    } finally {
      setClaiming(false);
    }
  };

  const startTextMode = () => {
    setTypedText(user?.signatureKind === 'typed' ? (user.signatureText ?? '') : '');
    setMode('text');
  };

  const startDrawMode = () => {
    setStrokes([]);
    setMode('draw');
  };

  const saveSignature = async (kind: SignatureKind, payload: { signature: string; signatureText?: string }) => {
    setSavingSignature(true);
    try {
      const res = await meApi.update({
        signature: payload.signature,
        signatureKind: kind,
        signatureText: payload.signatureText ?? null,
      });
      updateMe(res.user);
      setMode('none');
      show('Подпись сохранена');
    } catch (e) {
      Alert.alert('Подпись', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setSavingSignature(false);
    }
  };

  const saveTypedSignature = async () => {
    const text = typedText.trim();
    if (text.length < 2) {
      Alert.alert('Подпись', 'Введите подпись — не менее 2 символов');
      return;
    }
    await saveSignature('typed', { signature: typedSignatureDataUrl(text), signatureText: text });
  };

  const saveDrawnSignature = async () => {
    if (strokes.length === 0) {
      Alert.alert('Подпись', 'Сначала распишитесь');
      return;
    }
    await saveSignature('drawn', {
      signature: strokesToSignatureDataUrl(strokes, padSize.w || 320, padSize.h || 210),
    });
  };

  const deleteSignature = () => {
    Alert.alert('Удалить подпись?', 'Подпись можно будет создать заново', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              const res = await meApi.update({ signature: null, signatureKind: null });
              updateMe(res.user);
              setMode('none');
              show('Подпись удалена');
            } catch (e) {
              Alert.alert('Подпись', e instanceof Error ? e.message : 'Ошибка');
            }
          })();
        },
      },
    ]);
  };

  const confirmLogout = () => {
    Alert.alert('Выйти', 'Выйти из аккаунта?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  if (!user) return null;

  const hasSignature = !!user.signature;
  const isTypingPreview = typedText.trim().length > 0;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Профиль" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* ---- учётная запись ---- */}
        <View style={styles.card}>
          <View style={styles.avatarRow}>
            <Avatar name={user.displayName} color={user.avatarColor} size={64} />
            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>
                  {user.displayName}
                </Text>
                {user.isOwner ? <OwnerBadge compact /> : null}
              </View>
              <Text style={styles.meta} numberOfLines={1}>
                @{user.username}
              </Text>
            </View>
          </View>

          <Field
            label="Отображаемое имя"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Как вас будут видеть"
            maxLength={50}
          />
          <Field
            label="ФИО (для договоров)"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Иванов Иван Иванович"
            maxLength={120}
          />
          <View>
            <Text style={styles.label}>Email</Text>
            <View style={styles.readonly}>
              <Feather name="mail" size={15} color={colors.muted} />
              <Text style={styles.readonlyText} numberOfLines={1}>
                {user.email ?? '—'}
              </Text>
            </View>
          </View>
          <View>
            <Text style={styles.label}>Имя пользователя</Text>
            <View style={styles.readonly}>
              <Feather name="at-sign" size={15} color={colors.muted} />
              <Text style={styles.readonlyText} numberOfLines={1}>
                {user.username}
              </Text>
            </View>
          </View>

          <Button
            title="Сохранить профиль"
            loading={savingProfile}
            onPress={() => void saveProfile()}
          />
        </View>

        {/* ---- кошелёк ---- */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Feather name="credit-card" size={16} color={colors.accent} />
            <Text style={styles.cardTitle}>Кошелёк</Text>
          </View>
          <Pressable
            onPress={() => router.push('/wallet')}
            style={({ pressed }) => [styles.walletRow, pressed && { opacity: 0.8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.walletBalance, user.isOwner && styles.walletBalanceOwner]}>
                {formatBalance(user.balance)}
              </Text>
              <Text style={styles.hint}>Пополнение счёта, переводы и история операций</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.muted} />
          </Pressable>
        </View>

        {/* ---- карточка владельца ---- */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Feather name="award" size={16} color={colors.gold} />
            <Text style={styles.cardTitle}>Карточка владельца</Text>
          </View>

          {user.isOwner ? (
            <>
              <OwnerCard
                displayName={user.displayName}
                username={user.username}
                userId={user.id}
                balance={user.balance}
                card={user.card}
              />
              <Text style={styles.hint}>
                Вас всегда делают владельцем организации при вступлении
              </Text>
            </>
          ) : (
            <>
              <Field
                label="Код владельца"
                value={ownerCode}
                onChangeText={setOwnerCode}
                placeholder="Введите код"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={64}
                hint="Введите код, чтобы получить карточку владельца"
              />
              <Button
                title="Активировать"
                icon="key"
                loading={claiming}
                onPress={() => void claimOwner()}
              />
            </>
          )}
        </View>

        {/* ---- пароль ---- */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Сменить пароль</Text>
          <Field
            label="Текущий пароль"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="••••••"
            secureTextEntry
            autoCapitalize="none"
          />
          <Field
            label="Новый пароль"
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Не менее 6 символов"
            secureTextEntry
            autoCapitalize="none"
          />
          <Button
            title="Сменить пароль"
            variant="ghost"
            loading={savingPassword}
            onPress={() => void changePassword()}
          />
        </View>

        {/* ---- моя подпись ---- */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Feather name="pen-tool" size={16} color={colors.accent} />
            <Text style={styles.cardTitle}>Моя подпись</Text>
          </View>

          {!hasSignature && mode === 'none' ? (
            <>
              <View style={styles.stub}>
                <Feather name="edit-3" size={30} color={colors.muted} />
                <Text style={styles.stubText}>
                  Создайте свою подпись — потом будете подписывать документы в один клик
                </Text>
              </View>
              <View style={styles.rowButtons}>
                <Button
                  title="Напечатать подпись"
                  icon="type"
                  onPress={startTextMode}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Нарисовать подпись"
                  variant="ghost"
                  icon="pen-tool"
                  onPress={startDrawMode}
                  style={{ flex: 1 }}
                />
              </View>
            </>
          ) : null}

          {hasSignature && mode === 'none' ? (
            <>
              <SignaturePreview
                dataUrl={user.signature}
                kind={user.signatureKind === 'typed' ? 'typed' : 'drawn'}
                text={user.signatureText ?? null}
                height={96}
              />
              <View style={styles.rowButtons}>
                <Button title="Напечатать" icon="type" onPress={startTextMode} style={{ flex: 1 }} />
                <Button
                  title="Нарисовать"
                  variant="ghost"
                  icon="pen-tool"
                  onPress={startDrawMode}
                  style={{ flex: 1 }}
                />
              </View>
              <Button
                title="Удалить подпись"
                variant="danger"
                icon="trash-2"
                onPress={deleteSignature}
              />
            </>
          ) : null}

          {mode === 'text' ? (
            <>
              <Field
                label="Печатная подпись"
                value={typedText}
                onChangeText={setTypedText}
                placeholder="Алексей Иванов"
                maxLength={80}
              />
              <View style={styles.preview}>
                <Text
                  style={[styles.previewText, !isTypingPreview && styles.previewPlaceholder]}
                  numberOfLines={1}>
                  {isTypingPreview ? typedText.trim() : 'Так будет выглядеть ваша подпись'}
                </Text>
              </View>
              <Text style={styles.hint}>
                Введите имя или фразу — так будет выглядеть ваша подпись
              </Text>
              <View style={styles.rowButtons}>
                <Button
                  title="Сохранить подпись"
                  loading={savingSignature}
                  onPress={() => void saveTypedSignature()}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Отмена"
                  variant="ghost"
                  disabled={savingSignature}
                  onPress={() => setMode('none')}
                  style={{ flex: 1 }}
                />
              </View>
            </>
          ) : null}

          {mode === 'draw' ? (
            <>
              <SignaturePad strokes={strokes} onChange={setStrokes} onSize={(w, h) => setPadSize({ w, h })} />
              <Text style={styles.hint}>Или нарисуйте подпись курсором / пальцем</Text>
              <View style={styles.rowButtons}>
                <Button
                  title="Сохранить подпись"
                  disabled={strokes.length === 0}
                  loading={savingSignature}
                  onPress={() => void saveDrawnSignature()}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Отмена"
                  variant="ghost"
                  disabled={savingSignature}
                  onPress={() => setMode('none')}
                  style={{ flex: 1 }}
                />
              </View>
            </>
          ) : null}
        </View>

        <Button title="Выйти из аккаунта" variant="danger" icon="log-out" onPress={confirmLogout} />

        <Empty text="Atrium · тёмный мессенджер для организаций" />
      </ScrollView>
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
    gap: 14,
    paddingBottom: 48,
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
    gap: 12,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    flexShrink: 1,
  },
  meta: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    marginBottom: 6,
  },
  readonly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  readonlyText: {
    color: colors.text,
    fontSize: 15,
    flex: 1,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  stub: {
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 18,
    paddingHorizontal: 14,
  },
  stubText: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  walletBalance: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 3,
  },
  walletBalanceOwner: {
    color: colors.gold,
  },
  rowButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  preview: {
    backgroundColor: colors.bg,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  previewText: {
    color: colors.accent,
    fontFamily: CAVEAT_FONT,
    fontSize: 34,
    textAlign: 'center',
  },
  previewPlaceholder: {
    color: colors.muted,
    fontFamily: undefined,
    fontSize: 14,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
});
