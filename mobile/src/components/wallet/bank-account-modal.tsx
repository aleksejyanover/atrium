import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { Button, Field } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { walletApi } from '@/lib/endpoints';
import { colors } from '@/lib/theme';
import { BankAccount } from '@/lib/types';

interface Props {
  visible: boolean;
  onClose(): void;
  onDone(account: BankAccount): void;
}

/** Номер: 16 цифр карты или 20-символьный IBAN — как принимает сервер (SPEC v9 §40). */
function isValidAccountNumber(value: string): boolean {
  const clean = value.replace(/[^A-Za-z0-9]/g, '');
  return /^\d{16}$/.test(clean) || /^[A-Za-z]{2}\d{2}[A-Za-z0-9]{18}$/.test(clean);
}

/** Группировка цифр по 4 (карта) или оставляем IBAN как есть. */
function formatAccountInput(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 20);
  if (/^\d*$/.test(clean)) return clean.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  return clean;
}

/** Модалка привязки банковского счёта (SPEC v9 §40): номер не сохраняется — только маска. */
export function BankAccountModal({ visible, onClose, onDone }: Props) {
  const [number, setNumber] = useState('');
  const [holder, setHolder] = useState('');
  const [bank, setBank] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setNumber('');
    setHolder('');
    setBank('');
  };
  const close = () => {
    reset();
    onClose();
  };

  const valid =
    isValidAccountNumber(number) && holder.trim().length > 0 && bank.trim().length > 0;

  const submit = async () => {
    if (!valid) {
      Alert.alert(
        'Банковский счёт',
        'Укажите номер карты (16 цифр или IBAN), имя держателя и название банка',
      );
      return;
    }
    setBusy(true);
    try {
      const res = await walletApi.linkBankAccount({
        number,
        holder: holder.trim(),
        bank: bank.trim(),
      });
      reset();
      onDone(res.account);
    } catch (e) {
      Alert.alert('Банковский счёт', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      visible={visible}
      title="Привязать банковский счёт"
      onClose={close}
      footer={
        <Button
          title={valid ? 'Привязать счёт' : 'Заполните все поля'}
          loading={busy}
          onPress={() => void submit()}
        />
      }>
      <Field
        label="Номер карты"
        value={number}
        onChangeText={(v) => setNumber(formatAccountInput(v))}
        placeholder="0000 0000 0000 0000"
        autoCapitalize="characters"
        maxLength={24}
        hint="16 цифр или IBAN — номер не сохраняется, только маска"
      />
      <Field
        label="Имя держателя"
        value={holder}
        onChangeText={setHolder}
        placeholder="Иванов Иван"
        maxLength={100}
      />
      <Field
        label="Банк"
        value={bank}
        onChangeText={setBank}
        placeholder="Название банка"
        maxLength={100}
      />
      <Text style={styles.hint}>
        Счёт привязывается один: новая привязка заменяет старую, история операций сохраняется
      </Text>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  hint: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
});
