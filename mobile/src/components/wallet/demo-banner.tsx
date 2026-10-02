import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '@/lib/theme';

/**
 * Плашка «Демо-режим» (SPEC v4 §24): обязательна везде, где вводятся деньги —
 * реальных платежей нет, карта не списывается.
 */
export function DemoBanner({ text }: { text?: string }) {
  return (
    <View style={styles.banner}>
      <Feather name="info" size={14} color={colors.accent} />
      <Text style={styles.text}>
        {text ?? 'Демо-режим: карта не списывается, реальные деньги не участвуют'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(124,108,246,0.08)',
    borderColor: 'rgba(124,108,246,0.4)',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  text: {
    flex: 1,
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
});
