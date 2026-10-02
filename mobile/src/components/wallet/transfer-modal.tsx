import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, Field } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { DemoBanner } from '@/components/wallet/demo-banner';
import { usersApi, walletApi } from '@/lib/endpoints';
import { rub } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import { User } from '@/lib/types';

const SEARCH_DEBOUNCE_MS = 300;

interface Props {
  visible: boolean;
  /** Текущий баланс — для итога «после перевода». */
  balance: number;
  /** Мой id — не показывать себя в поиске получателей. */
  meId: string;
  onClose(): void;
  /** Успешный перевод: родитель перечитывает кошелёк и показывает тост. */
  onDone(amount: number, to: User): void;
}

/** Модалка перевода другому пользователю (SPEC v4 §24). */
export function TransferModal({ visible, balance, meId, onClose, onDone }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<User | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced поиск пользователей (GET /api/users/search, 300ms — как в каталоге).
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const signal = { cancelled: false };
    const q = query.trim();
    debounceRef.current = setTimeout(() => {
      if (!q || selected) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      usersApi
        .search(q)
        .then((res) => {
          if (!signal.cancelled) setResults(res.users.filter((u) => u.id !== meId));
        })
        .catch(() => {
          if (!signal.cancelled) setResults([]);
        })
        .finally(() => {
          if (!signal.cancelled) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      signal.cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, visible, selected, meId]);

  const amountValue = parseInt(amount.replace(/\D/g, ''), 10) || 0;
  const after = balance - amountValue;
  const insufficient = amountValue > 0 && after < 0;

  // Сброс полей при закрытии: состояние живёт, только пока модалка открыта.
  const reset = () => {
    setQuery('');
    setResults([]);
    setSelected(null);
    setAmount('');
    setNote('');
  };
  const close = () => {
    reset();
    onClose();
  };

  const doTransfer = async (to: User, value: number) => {
    setBusy(true);
    try {
      await walletApi.transfer({
        toUserId: to.id,
        amount: value,
        note: note.trim() || undefined,
      });
      reset();
      onDone(value, to);
    } catch (e) {
      // 409 «Недостаточно средств», 400/404 — серверное сообщение по-русски.
      Alert.alert('Перевод', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!selected) {
      Alert.alert('Перевод', 'Найдите и выберите получателя');
      return;
    }
    if (amountValue < 1 || amountValue > 500000) {
      Alert.alert('Перевод', 'Сумма перевода: 1–500 000 ₽');
      return;
    }
    if (insufficient) {
      Alert.alert('Перевод', 'Недостаточно средств');
      return;
    }
    Alert.alert(
      'Перевести',
      `Перевести ${rub(amountValue)} пользователю ${selected.displayName}? Демо-режим: реальные деньги не участвуют`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Перевести', onPress: () => void doTransfer(selected, amountValue) },
      ],
    );
  };

  return (
    <AppModal
      visible={visible}
      title="Перевести"
      onClose={close}
      footer={
        <Button
          title={amountValue > 0 ? `Перевести ${rub(amountValue)}` : 'Перевести'}
          loading={busy}
          onPress={submit}
        />
      }>
      <DemoBanner text="Демо-режим: переводы имитируются, реальные деньги не участвуют" />

      {selected ? (
        <View style={styles.selectedRow}>
          <Avatar name={selected.displayName} color={selected.avatarColor} size={36} />
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>
              {selected.displayName}
            </Text>
            <Text style={styles.userMeta} numberOfLines={1}>
              @{selected.username}
            </Text>
          </View>
          <Pressable onPress={() => setSelected(null)} hitSlop={8}>
            <Feather name="x" size={18} color={colors.muted} />
          </Pressable>
        </View>
      ) : (
        <>
          <Field
            label="Получатель"
            value={query}
            onChangeText={(v) => {
              setSelected(null);
              setQuery(v);
            }}
            placeholder="Имя пользователя или @ник"
            autoCapitalize="none"
            maxLength={40}
          />

          {searching ? (
            <View style={styles.searchingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.searchingText}>Ищем пользователей…</Text>
            </View>
          ) : null}

          {!searching && query.trim() && results.length === 0 ? (
            <Text style={styles.nothing}>Ничего не найдено</Text>
          ) : null}

          {results.map((u) => (
            <Pressable
              key={u.id}
              onPress={() => setSelected(u)}
              style={({ pressed }) => [styles.userRow, pressed && { opacity: 0.75 }]}>
              <Avatar name={u.displayName} color={u.avatarColor} size={34} />
              <View style={{ flex: 1 }}>
                <Text style={styles.userName} numberOfLines={1}>
                  {u.displayName}
                </Text>
                <Text style={styles.userMeta} numberOfLines={1}>
                  @{u.username}
                </Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.muted} />
            </Pressable>
          ))}
        </>
      )}

      <Field
        label="Сумма, ₽"
        value={amount}
        onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 6))}
        placeholder="1 – 500 000"
        keyboardType="number-pad"
        maxLength={6}
      />
      <Field
        label="Комментарий (необязательно)"
        value={note}
        onChangeText={setNote}
        placeholder="За что / за период"
        maxLength={300}
      />

      <View style={styles.total}>
        <Text style={styles.totalRow}>
          <Text style={styles.totalLabel}>Баланс: </Text>
          {rub(balance)}
        </Text>
        <Text style={styles.totalRow}>
          <Text style={styles.totalLabel}>К переводу: </Text>
          {rub(amountValue)}
        </Text>
        <Text style={[styles.totalRow, insufficient && { color: colors.danger }]}>
          <Text style={styles.totalLabel}>После перевода: </Text>
          {insufficient ? 'Недостаточно средств' : rub(Math.max(after, 0))}
        </Text>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel2,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  userName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  userMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  searchingText: {
    color: colors.muted,
    fontSize: 12,
  },
  nothing: {
    color: colors.muted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 6,
  },
  total: {
    gap: 4,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  totalRow: {
    color: colors.text,
    fontSize: 13,
  },
  totalLabel: {
    color: colors.muted,
    fontSize: 13,
  },
});
