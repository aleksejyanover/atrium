import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Field } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { walletApi } from '@/lib/endpoints';
import { formatBalance, formatCardNumber, rub } from '@/lib/format';
import { colors, radius } from '@/lib/theme';

const QUICK_AMOUNTS = [500, 1000, 5000];

interface Props {
  visible: boolean;
  /** Текущий баланс — подсказка под суммой (обычное число, SPEC v6 §32). */
  balance: number | null;
  /** Владелец: требуется пароль карты, лимит суммы снят (SPEC v6 §32). */
  isOwner: boolean;
  onClose(): void;
  /** Успешное пополнение: родитель перечитывает кошелёк и показывает тост. */
  onDone(amount: number): void;
}

/** Модалка пополнения счёта картой (SPEC v5 §30 — нейтральные банковские тексты). */
export function TopupModal({ visible, balance, isOwner, onClose, onDone }: Props) {
  const [amount, setAmount] = useState('');
  const [card, setCard] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  const amountValue = parseInt(amount.replace(/\D/g, ''), 10) || 0;
  const cardDigits = card.replace(/\D/g, '');
  // Владелец: сумма от 1 ₽ без верхней границы, обязателен пароль карты (SPEC v6 §32).
  const valid = isOwner
    ? amountValue >= 1 && cardDigits.length === 16 && pin.length === 4
    : amountValue >= 100 && amountValue <= 500000 && cardDigits.length === 16;
  const amountLimit = isOwner ? 9 : 6;

  // Сброс полей при закрытии: состояние живёт, только пока модалка открыта.
  const reset = () => {
    setAmount('');
    setCard('');
    setPin('');
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    if (!valid) {
      Alert.alert(
        'Пополнение',
        isOwner
          ? 'Укажите сумму (от 1 ₽), номер карты — 16 цифр и пароль карты — 4 цифры'
          : 'Укажите сумму (100–500 000 ₽) и номер карты — 16 цифр',
      );
      return;
    }
    setBusy(true);
    try {
      await walletApi.topup({
        amount: amountValue,
        cardNumber: cardDigits,
        ...(isOwner ? { pin } : {}),
      });
      reset();
      onDone(amountValue);
    } catch (e) {
      // 400 «Неверный пароль карты» — серверное сообщение в алерте.
      Alert.alert('Пополнение', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      visible={visible}
      title="Пополнить счёт"
      onClose={close}
      footer={
        <Button
          title={valid ? `Пополнить на ${rub(amountValue)}` : 'Пополнить счёт'}
          loading={busy}
          onPress={() => void submit()}
        />
      }>
      <Field
        label="Сумма пополнения, ₽"
        value={amount}
        onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, amountLimit))}
        placeholder={isOwner ? 'Любая сумма от 1 ₽' : '100 – 500 000'}
        keyboardType="number-pad"
        maxLength={amountLimit}
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

      <Field
        label="Номер карты"
        value={card}
        onChangeText={(v) => setCard(formatCardNumber(v))}
        placeholder="0000 0000 0000 0000"
        keyboardType="number-pad"
        maxLength={19}
        hint="16 цифр с лицевой стороны карты"
      />

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

      <Text style={styles.balanceHint}>Текущий баланс: {formatBalance(balance)}</Text>
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
  balanceHint: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
});
