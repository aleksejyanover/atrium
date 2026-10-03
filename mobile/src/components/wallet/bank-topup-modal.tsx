import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Field } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { walletApi } from '@/lib/endpoints';
import { rub } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import { BankAccount } from '@/lib/types';

const QUICK_AMOUNTS = [500, 1000, 5000];

interface Props {
  visible: boolean;
  account: BankAccount;
  onClose(): void;
  /** Успешное пополнение: родитель перечитывает кошелёк/банк и показывает тост. */
  onDone(amount: number): void;
}

/** Модалка пополнения счёта приложения с привязанной банковской карты (SPEC v9 §40).
 *  Входящая операция — пароль карты не требуется. */
export function BankTopupModal({ visible, account, onClose, onDone }: Props) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);

  const amountValue = parseInt(amount.replace(/\D/g, ''), 10) || 0;
  const valid = amountValue >= 1 && amountValue <= 5000000;

  const reset = () => setAmount('');
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!valid) {
      Alert.alert('Пополнение с карты', 'Укажите сумму от 1 до 5 000 000 ₽');
      return;
    }
    setBusy(true);
    try {
      await walletApi.bankTopup({ amount: amountValue });
      reset();
      onDone(amountValue);
    } catch (e) {
      Alert.alert('Пополнение с карты', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      visible={visible}
      title="Пополнить с карты"
      onClose={close}
      footer={
        <Button
          title={valid ? `Пополнить на ${rub(amountValue)}` : 'Пополнить с карты'}
          loading={busy}
          onPress={() => void submit()}
        />
      }>
      <Field
        label="Сумма, ₽"
        value={amount}
        onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 7))}
        placeholder="1000"
        keyboardType="number-pad"
        maxLength={7}
        hint="От 1 до 5 000 000 ₽ за одну операцию"
      />

      <View style={styles.chips}>
        {QUICK_AMOUNTS.map((value) => (
          <Pressable
            key={value}
            onPress={() => setAmount(String(value))}
            style={({ pressed }) => [
              styles.chip,
              amountValue === value && styles.chipActive,
              pressed && { opacity: 0.75 },
            ]}>
            <Text style={[styles.chipText, amountValue === value && styles.chipTextActive]}>
              {rub(value)}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.accountBox}>
        <Text style={styles.accountTitle}>Карта списания</Text>
        <Text style={styles.accountValue}>
          {account.bank} · {account.numberMasked}
        </Text>
        <Text style={styles.accountMeta}>{account.holder}</Text>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(124,108,246,0.12)',
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.accent,
  },
  accountBox: {
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    gap: 2,
  },
  accountTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  accountValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  accountMeta: {
    color: colors.muted,
    fontSize: 12,
  },
});
