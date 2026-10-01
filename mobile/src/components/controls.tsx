import { Feather } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';

import { colors, fontMedium, radius } from '@/lib/theme';

type IconName = keyof typeof Feather.glyphMap;

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  small?: boolean;
  style?: ViewStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  icon,
  small,
  style,
}: ButtonProps) {
  const inactive = disabled || loading;
  const bg =
    variant === 'primary' ? (inactive ? '#4B447F' : colors.accent) : 'transparent';
  const fg = variant === 'primary' ? '#FFFFFF' : variant === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        {
          backgroundColor: bg,
          borderColor:
            variant === 'primary' ? (inactive ? '#4B447F' : colors.accent) : colors.border,
          opacity: pressed && !inactive ? 0.85 : 1,
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <View style={styles.buttonRow}>
          {icon ? <Feather name={icon} size={small ? 14 : 16} color={fg} /> : null}
          <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color: fg }]}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
}

export function Field({ label, hint, style, ...rest }: FieldProps) {
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...rest}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function IconButton({
  name,
  onPress,
  color = colors.text,
  size = 20,
  bg = colors.panel2,
  disabled,
}: {
  name: IconName;
  onPress?: () => void;
  color?: string;
  size?: number;
  bg?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        width: size + 20,
        height: size + 20,
        borderRadius: (size + 20) / 2,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed || disabled ? 0.6 : 1,
      })}>
      <Feather name={name} size={size} color={color} />
    </Pressable>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  buttonSmall: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: fontMedium,
  },
  buttonTextSmall: {
    fontSize: 13,
  },
  fieldWrap: {
    gap: 6,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
  },
  hint: {
    color: colors.muted,
    fontSize: 11,
    opacity: 0.8,
  },
  input: {
    backgroundColor: colors.panel2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    textAlign: 'center',
  },
});
