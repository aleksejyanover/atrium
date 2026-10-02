import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, setAuthToken, setUnauthorizedHandler } from '@/lib/api';
import { authApi } from '@/lib/endpoints';
import { User } from '@/lib/types';

const TOKEN_KEY = 'atrium_token';

interface AuthContextValue {
  token: string | null;
  user: User | null;
  /** true once the stored token has been resolved (me / logout). */
  ready: boolean;
  login(login: string, password: string): Promise<void>;
  register(payload: {
    username: string;
    displayName: string;
    email: string;
    password: string;
  }): Promise<void>;
  logout(): Promise<void>;
  /** Локально применить обновлённого пользователя (PATCH /api/me). */
  updateMe(user: User): void;
  /** Перечитать профиль с сервера. */
  refreshMe(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const logoutRef = useRef<() => void>(() => {});

  const logout = useCallback(async () => {
    setAuthToken(null);
    setToken(null);
    setUser(null);
    try {
      await AsyncStorage.removeItem(TOKEN_KEY);
    } catch {
      // storage is best-effort
    }
  }, []);

  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      void logoutRef.current();
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Restore session on startup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(TOKEN_KEY);
        if (stored && !cancelled) {
          setAuthToken(stored);
          setToken(stored);
          try {
            const { user: me } = await authApi.me();
            if (!cancelled) setUser(me);
          } catch (e) {
            // Network problems keep the session (server may just be unreachable),
            // an explicit rejection invalidates it.
            const invalid =
              e instanceof ApiError && e.status !== 0 && e.status !== 403;
            if (invalid && !cancelled) {
              await AsyncStorage.removeItem(TOKEN_KEY);
              setAuthToken(null);
              if (!cancelled) setToken(null);
            }
          }
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (loginValue: string, password: string) => {
    const res = await authApi.login(loginValue, password);
    setAuthToken(res.token);
    await AsyncStorage.setItem(TOKEN_KEY, res.token);
    setUser(res.user);
    setToken(res.token);
  }, []);

  const register = useCallback(
    async (payload: {
      username: string;
      displayName: string;
      email: string;
      password: string;
    }) => {
      const res = await authApi.register(payload);
      setAuthToken(res.token);
      await AsyncStorage.setItem(TOKEN_KEY, res.token);
      setUser(res.user);
      setToken(res.token);
    },
    [],
  );

  const updateMe = useCallback((next: User) => {
    setUser(next);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const { user: me } = await authApi.me();
      setUser(me);
    } catch {
      // сеть недоступна — оставляем текущий профиль
    }
  }, []);

  const value = useMemo(
    () => ({ token, user, ready, login, register, logout, updateMe, refreshMe }),
    [token, user, ready, login, register, logout, updateMe, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
