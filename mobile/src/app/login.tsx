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

export default function LoginScreen() {
  useRedirectIfAuthed();
  const { login } = useAuth();
  const router = useRouter();

  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!loginValue.trim() || !password) {
      setError('Заполните все поля');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await login(loginValue.trim(), password);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось войти');
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
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.brand}>ATRIUM</Text>
            <Text style={styles.title}>Вход</Text>
            <Text style={styles.subtitle}>Мессенджер для организаций</Text>

            <Field
              label="Логин или email"
              value={loginValue}
              onChangeText={setLoginValue}
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
              placeholder="••••••"
              onSubmitEditing={() => void submit()}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button title="Войти" onPress={() => void submit()} loading={loading} />
          </View>

          <Link href="/register" asChild>
            <Pressable style={styles.link}>
              <Text style={styles.linkText}>
                Нет аккаунта? <Text style={styles.linkAccent}>Регистрация</Text>
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
