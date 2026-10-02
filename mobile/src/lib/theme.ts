import { Platform, TextStyle, ViewStyle } from 'react-native';

/** Dark-only design tokens — identical to SPEC.md section 1. */
export const colors = {
  bg: '#0A0A0C',
  panel: '#121216',
  panel2: '#17171C',
  border: '#232329',
  text: '#ECECEF',
  muted: '#8B8B94',
  accent: '#7C6CF6',
  accent2: '#6C5CE7',
  danger: '#F0506E',
  ok: '#3ECF8E',
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 14,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const font = Platform.select({
  ios: '-apple-system',
  android: 'sans-serif',
  default: 'system',
}) as string;

export const fontMedium = Platform.select({
  ios: '-apple-system',
  android: 'sans-serif-medium',
  default: 'system',
}) as string;

/** Шрифт личной подписи (Caveat, @expo-google-fonts/caveat — SPEC §17). */
export const CAVEAT_FONT = 'Caveat_400Regular';

/** No heavy shadows — at most a soft one on modals (SPEC). */
export const modalShadow: ViewStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.4,
  shadowRadius: 30,
  elevation: 12,
};

export const textPrimary: TextStyle = {
  color: colors.text,
  fontSize: 15,
};

export const textMuted: TextStyle = {
  color: colors.muted,
  fontSize: 13,
};

/** 1px hairline card. */
export const card: ViewStyle = {
  backgroundColor: colors.panel,
  borderColor: colors.border,
  borderWidth: 1,
  borderRadius: radius.lg,
};
