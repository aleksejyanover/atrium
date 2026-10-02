import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '@/lib/theme';

/**
 * Прокручиваемый текст договора (SPEC v2 §15.2, §14.4).
 * Фиксированная высота, отдельный скролл — форма подписи остаётся компактной.
 */
export function ContractText({
  text,
  title = 'Договор',
  height = 260,
}: {
  text: string;
  title?: string;
  height?: number;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <ScrollView style={[styles.scroll, { maxHeight: height }]} nestedScrollEnabled>
        {text.split('\n').map((line, index) => (
          <Text key={index} style={styles.line}>
            {line.length > 0 ? line : ' '}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  title: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  scroll: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
  },
  line: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
  },
});
