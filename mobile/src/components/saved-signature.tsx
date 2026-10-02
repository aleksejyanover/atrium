import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SignaturePreview } from '@/components/signature-preview';
import { colors, radius } from '@/lib/theme';
import { signatureTextFromDataUrl } from '@/lib/signature';
import { User } from '@/lib/types';

interface Props {
  user: User | null;
  /** Подпись уже применена к текущему договору. */
  applied: boolean;
  /** Одно нажатие: подставить подпись и ФИО из профиля (SPEC v3 §17). */
  onApply(): void;
  /** Вернуться к рисованию подписи от руки. */
  onClear(): void;
  /** Перейти в профиль (создать/изменить подпись). */
  onProfile(): void;
}

/** Поля подписи для отправки на сервер (dataUrl всегда + текст для печатной). */
export function savedSignaturePayload(
  user: User | null,
): { signatureDataUrl: string; signatureText?: string } | null {
  const signature = user?.signature;
  if (!signature) return null;
  const text =
    user.signatureText?.trim() ||
    (user.signatureKind === 'typed' ? signatureTextFromDataUrl(signature) : null);
  return text ? { signatureDataUrl: signature, signatureText: text } : { signatureDataUrl: signature };
}

/**
 * Панель «Использовать мою подпись» над формой подписания договора (SPEC v3 §17):
 * при сохранённой подписи — превью + один клик; без подписи — подсказка в профиль.
 */
export function SavedSignatureCard({ user, applied, onApply, onClear, onProfile }: Props) {
  const saved = savedSignaturePayload(user);

  if (!saved) {
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <Feather name="pen-tool" size={16} color={colors.accent} />
          <Text style={styles.title}>Своя подпись</Text>
        </View>
        <Text style={styles.hint}>
          Создайте свою подпись в профиле — подписание займёт один клик
        </Text>
        <Pressable onPress={onProfile} hitSlop={8} style={styles.link}>
          <Text style={styles.linkText}>Создать подпись</Text>
          <Feather name="chevron-right" size={14} color={colors.accent} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.card, applied && styles.cardApplied]}>
      <View style={styles.row}>
        <Feather name={applied ? 'check-circle' : 'pen-tool'} size={16} color={colors.accent} />
        <Text style={styles.title}>{applied ? 'Подпись применена' : 'Моя подпись'}</Text>
        {applied ? (
          <Pressable onPress={onClear} hitSlop={8} style={styles.link}>
            <Text style={styles.linkText}>Нарисовать подпись</Text>
          </Pressable>
        ) : null}
      </View>

      <SignaturePreview
        dataUrl={saved.signatureDataUrl}
        kind={user?.signatureKind === 'typed' ? 'typed' : 'drawn'}
        text={saved.signatureText ?? null}
        height={72}
      />

      {applied ? (
        <Text style={styles.hint}>
          ФИО подставлено из профиля — при необходимости поправьте поле ниже
        </Text>
      ) : (
        <View style={styles.actions}>
          <Pressable onPress={onApply} style={styles.applyButton}>
            <Text style={styles.applyText}>Использовать мою подпись</Text>
          </Pressable>
          <Pressable onPress={onProfile} hitSlop={8} style={styles.link}>
            <Text style={styles.linkText}>Изменить подпись</Text>
            <Feather name="chevron-right" size={14} color={colors.accent} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
    gap: 10,
  },
  cardApplied: {
    borderColor: 'rgba(124,108,246,0.55)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  hint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  actions: {
    gap: 8,
    alignItems: 'flex-start',
  },
  applyButton: {
    minHeight: 40,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,108,246,0.16)',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  applyText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  linkText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
});
