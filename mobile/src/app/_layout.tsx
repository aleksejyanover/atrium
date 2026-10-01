import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CallOverlays } from '@/components/call-overlay';
import { colors } from '@/lib/theme';
import { AuthProvider } from '@/state/auth';
import { CallProvider } from '@/state/call';
import { OrgsProvider } from '@/state/orgs';
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
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={theme}>
          <AuthProvider>
            <SocketProvider>
              <OrgsProvider>
                <ToastProvider>
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
                </ToastProvider>
              </OrgsProvider>
            </SocketProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
