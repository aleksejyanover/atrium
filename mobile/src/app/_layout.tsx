import { Caveat_400Regular } from '@expo-google-fonts/caveat';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CallOverlays } from '@/components/call-overlay';
import { ErrorBoundary } from '@/components/error-boundary';
import { colors } from '@/lib/theme';
import { AuthProvider } from '@/state/auth';
import { CallProvider } from '@/state/call';
import { OrgsProvider } from '@/state/orgs';
import { RealtimeProvider } from '@/state/realtime';
import { SocketProvider } from '@/state/socket';
import { ToastProvider } from '@/state/toast';

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.panel,
    primary: colors.accent,
    text: colors.text,
    border: colors.border,
    notification: colors.accent,
  },
};

export default function RootLayout() {
  // Caveat — шрифт печатной подписи (SPEC v2.1/v3 §17)
  useFonts({ Caveat_400Regular });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <SafeAreaProvider>
          <ThemeProvider value={theme}>
            <AuthProvider>
              <SocketProvider>
                <OrgsProvider>
                  <ToastProvider>
                    <RealtimeProvider>
                      <CallProvider>
                        <StatusBar style="light" />
                        <Stack
                          screenOptions={{
                            headerShown: false,
                            contentStyle: { backgroundColor: colors.bg },
                            animation: 'slide_from_right',
                          }}
                        />
                        <CallOverlays />
                      </CallProvider>
                    </RealtimeProvider>
                  </ToastProvider>
                </OrgsProvider>
              </SocketProvider>
            </AuthProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
