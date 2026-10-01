import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useAuth } from '@/state/auth';

/** Sends an authenticated user away from /login and /register. */
export function useRedirectIfAuthed(): void {
  const { token, ready } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (ready && token) router.replace('/');
  }, [ready, token, router]);
}
