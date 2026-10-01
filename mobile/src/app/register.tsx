import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Field } from '@/components/controls';
import { useRedirectIfAuthed } from '@/hooks/use-redirect-if-authed';
import { colors, radius } from '@/lib/theme';
import { useAuth } from '@/state/auth';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export default function RegisterScreen() {
  useRedirectIfAuthed();
  const { register } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const u = username.trim().toLowerCase();
    const d = displayName.trim();
    const e = email.trim();
    if (!u || !d || !e || !password) {
      setError('Заполните все поля');
      return;
    }
    if (!USERNAME_RE.test(u)) {
      setError('Имя пользователя: 3–20 символов, строчные буквы, цифры и «_»');
      return;
    }
    if (!e.includes('@')) {
      setError('Введите корректный email');
      return;
    }
    if (password.length < 6) {
      setError('Пароль должен содержать минимум 6 символов');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await register({ username: u, displayName: d, email: e, password });
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось зарегистрироваться');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.glow} />
      <KeyboardAvoidingView
        style={styles.center}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.brand}>ATRIUM</Text>
            <Text style={styles.title}>Регистрация</Text>
            <Text style={styles.subtitle}>Создайте аккаунт за минуту</Text>

            <Field
              label="Имя пользователя"
              value={username}
              onChangeText={(v) => setUsername(v.replace(/\s/g, '').toLowerCase())}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="alex"
              hint="3–20 символов: a–z, 0–9, «_»"
            />
            <Field
              label="Отображаемое имя"
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Алексей"
            />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="alex@example.com"
            />
            <Field
              label="Пароль"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="Минимум 6 символов"
              onSubmitEditing={() => void submit()}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button title="Зарегистрироваться" onPress={() => void submit()} loading={loading} />
          </View>

          <Link href="/login" asChild>
            <Pressable style={styles.link}>
              <Text style={styles.linkText}>
                Уже есть аккаунт? <Text style={styles.linkAccent}>Войти</Text>
              </Text>
            </Pressable>
          </Link>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  glow: {
    position: 'absolute',
    alignSelf: 'center',
    top: -140,
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: colors.accent,
    opacity: 0.14,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
  },
  scroll: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
    gap: 18,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 22,
    gap: 14,
  },
  brand: {
    color: colors.accent,
    fontSize: 12,
    letterSpacing: 3,
    fontWeight: '700',
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    marginTop: -8,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  link: {
    paddingVertical: 8,
  },
  linkText: {
    color: colors.muted,
    fontSize: 14,
  },
  linkAccent: {
    color: colors.accent,
    fontWeight: '600',
  },
});
