import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Field } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { walletApi } from '@/lib/endpoints';
import { formatBalance, rub } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import { BankAccount } from '@/lib/types';

const QUICK_AMOUNTS = [500, 1000, 5000];

interface Props {
  visible: boolean;
  account: BankAccount;
  /** Текущий баланс — обычное число (SPEC v6 §32). */
  balance: number;
  /** Владелец: пароль карты обязателен, баланс не списывается (SPEC v6 §32). */
  isOwner: boolean;
  onClose(): void;
  /** Успешный вывод: родитель перечитывает кошелёк/банк и показывает тост. */
  onDone(amount: number): void;
}

/** Модалка вывода на привязанную банковскую карту (SPEC v9 §40). */
export function BankWithdrawModal({ visible, account, balance, isOwner, onClose, onDone }: Props) {
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const amountValue = parseInt(amount.replace(/\D/g, ''), 10) || 0;
  const valid = isOwner
    ? amountValue >= 1 && pin.length === 4
    : amountValue >= 1 && amountValue <= balance;
  const amountLimit = isOwner ? 9 : 7;

  const reset = () => {
    setAmount('');
    setPin('');
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!valid) {
      Alert.alert(
        'Вывод на карту',
        isOwner
          ? 'Укажите сумму (от 1 ₽) и пароль карты — 4 цифры'
          : 'Укажите сумму от 1 ₽ не больше доступного баланса',
      );
      return;
    }
    setBusy(true);
    try {
      await walletApi.bankWithdraw({
        amount: amountValue,
        ...(isOwner ? { pin } : {}),
      });
      reset();
      onDone(amountValue);
    } catch (e) {
      // 400 «Неверный пароль карты» / 409 «Недостаточно средств» — серверный текст.
      Alert.alert('Вывод на карту', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      visible={visible}
      title="Вывести на карту"
      onClose={close}
      footer={
        <Button
          title={valid ? `Перевести ${rub(amountValue)}` : 'Перевести на карту'}
          loading={busy}
          onPress={() => void submit()}
        />
      }>
      <Field
        label="Сумма, ₽"
        value={amount}
        onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, amountLimit))}
        placeholder="1000"
        keyboardType="number-pad"
        maxLength={amountLimit}
        hint={isOwner ? 'Любая сумма от 1 ₽' : `Доступно: ${formatBalance(balance)}`}
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
        <Text style={styles.accountTitle}>Карта получателя</Text>
        <Text style={styles.accountValue}>
          {account.bank} · {account.numberMasked}
        </Text>
        <Text style={styles.accountMeta}>{account.holder}</Text>
      </View>

      {isOwner ? (
        <Field
          label="Пароль карты"
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
          placeholder="0000"
          keyboardType="number-pad"
          maxLength={4}
          hint="Пароль запрашивается при каждой операции с деньгами"
        />
      ) : null}
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
