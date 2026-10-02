import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { formatDate, formatTime, rubSigned } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import { PaymentKind } from '@/lib/types';

type IconName = keyof typeof Feather.glyphMap;

interface Props {
  kind: PaymentKind;
  /** Целые рубли, всегда положительное число — знак задаётся incoming. */
  amount: number;
  /** Плюс (деньги пришли) или минус (деньги ушли). */
  incoming: boolean;
  /** Контрагент: пользователь, организация или название операции. */
  title: string;
  meta?: string | null;
  note?: string | null;
  createdAt: number;
}

const KIND_ICONS: Record<PaymentKind, IconName> = {
  topup: 'download',
  transfer: 'arrow-up-right',
  salary: 'briefcase',
  treasury_deposit: 'upload',
};

/** Строка истории операций кошелька / казначейства (SPEC v4 §24, тексты v5 §30). */
export function PaymentRow({ kind, amount, incoming, title, meta, note, createdAt }: Props) {
  const icon: IconName =
    kind === 'transfer' ? (incoming ? 'arrow-down-left' : 'arrow-up-right') : KIND_ICONS[kind];
  const tint = incoming ? colors.ok : colors.danger;

  return (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { borderColor: incoming ? 'rgba(62,207,142,0.4)' : 'rgba(240,80,110,0.35)' }]}>
        <Feather name={icon} size={16} color={tint} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
        {note ? (
          <Text style={styles.note} numberOfLines={2}>
            {note}
          </Text>
        ) : null}
        <View style={styles.timeRow}>
          <Text style={styles.time}>
            {formatDate(createdAt)} · {formatTime(createdAt)}
          </Text>
        </View>
      </View>

      <Text style={[styles.amount, { color: incoming ? colors.ok : colors.text }]}>
        {rubSigned(amount, incoming)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    backgroundColor: colors.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  meta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  note: {
    color: colors.muted,
    fontSize: 12,
    fontStyle: 'italic',
    marginTop: 3,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  time: {
    color: colors.muted,
    fontSize: 11,
    opacity: 0.85,
  },
  amount: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'right',
    minWidth: 74,
  },
});
