import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Button, Empty, Field } from '@/components/controls';
import { AppModal } from '@/components/modal';
import { DemoBanner } from '@/components/wallet/demo-banner';
import { PaymentRow } from '@/components/wallet/payment-row';
import { orgsApi } from '@/lib/endpoints';
import { rub } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import { Member, OrgFinance, OrgFinanceTx } from '@/lib/types';
import { useAuth } from '@/state/auth';
import { useSocketEvent } from '@/state/socket';
import { useToast } from '@/state/toast';

interface Props {
  orgId: string;
  members: Member[];
  meId: string;
}

/** Строка истории казначейства → пропсы PaymentRow (SPEC v4 §24). */
function txRowProps(tx: OrgFinanceTx, meId: string, canManage: boolean) {
  if (tx.kind === 'treasury_deposit') {
    return {
      title: 'Пополнение казначейства',
      meta: tx.fromUser ? `от ${tx.fromUser.displayName}` : null,
      incoming: true,
    };
  }
  // kind === 'salary': для казначейства это минус, для получателя — плюс.
  const to = tx.toUser;
  return {
    title: 'Зарплата',
    meta: to ? (to.id === meId ? `${to.displayName} (вы)` : to.displayName) : null,
    incoming: !canManage,
  };
}

/**
 * «Финансы организации» (SPEC v4 §24):
 * rank ≥ 60 — казначейство, пополнение, выплаты, история и «Выплачено»;
 * обычный участник — только раздел «Мои начисления» этой организации.
 */
export function FinanceTab({ orgId, members, meId }: Props) {
  const { show } = useToast();
  const { user, refreshMe } = useAuth();

  const [finance, setFinance] = useState<OrgFinance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // --- пополнение казначейства ---
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositBusy, setDepositBusy] = useState(false);

  // --- выплата зарплаты ---
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [payrollUserId, setPayrollUserId] = useState<string | null>(null);
  const [payrollAmount, setPayrollAmount] = useState('');
  const [payrollNote, setPayrollNote] = useState('');
  const [payrollBusy, setPayrollBusy] = useState(false);

  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      try {
        const res = await orgsApi.finance(orgId);
        if (signal?.cancelled) return;
        setFinance(res);
        setError(null);
      } catch (e) {
        if (signal?.cancelled) return;
        setError(e instanceof Error ? e.message : 'Не удалось загрузить финансы');
      } finally {
        if (!signal?.cancelled) setLoading(false);
      }
    },
    [orgId],
  );

  useFocusEffect(
    useCallback(() => {
      const signal = { cancelled: false };
      void load(signal);
      return () => {
        signal.cancelled = true;
      };
    }, [load]),
  );

  // realtime: баланс изменился (зарплата, пополнение казначейства из кошелька)
  useSocketEvent('wallet:updated', () => {
    void load();
    void refreshMe();
  });

  const openDeposit = () => {
    setDepositAmount('');
    setDepositOpen(true);
  };

  const submitDeposit = async () => {
    const value = parseInt(depositAmount.replace(/\D/g, ''), 10) || 0;
    if (value < 1) {
      Alert.alert('Пополнить казначейство', 'Укажите сумму');
      return;
    }
    if (value > (user?.balance ?? 0)) {
      Alert.alert('Пополнить казначейство', 'Недостаточно средств на личном балансе');
      return;
    }
    setDepositBusy(true);
    try {
      await orgsApi.treasuryDeposit(orgId, value);
      setDepositOpen(false);
      setDepositAmount('');
      await load();
      void refreshMe();
      show(`Казначейство пополнено: +${rub(value)}`);
    } catch (e) {
      // 409 «Недостаточно средств»
      Alert.alert('Пополнить казначейство', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setDepositBusy(false);
    }
  };

  const openPayroll = () => {
    setPayrollUserId(null);
    setPayrollAmount('');
    setPayrollNote('');
    setPayrollOpen(true);
  };

  const submitPayroll = async () => {
    const value = parseInt(payrollAmount.replace(/\D/g, ''), 10) || 0;
    const target = members.find((m) => m.user.id === payrollUserId);
    if (!target) {
      Alert.alert('Выплатить зарплату', 'Выберите сотрудника');
      return;
    }
    if (value < 1) {
      Alert.alert('Выплатить зарплату', 'Укажите сумму');
      return;
    }
    if (value > (finance?.balance ?? 0)) {
      Alert.alert('Выплатить зарплату', 'Недостаточно средств в казначействе');
      return;
    }
    setPayrollBusy(true);
    try {
      await orgsApi.payroll(orgId, {
        userId: target.user.id,
        amount: value,
        note: payrollNote.trim() || undefined,
      });
      setPayrollOpen(false);
      await load();
      if (target.user.id === meId) void refreshMe();
      show(`Выплачено: ${rub(value)} → ${target.user.displayName}`);
    } catch (e) {
      // 409 «Недостаточно средств в казначействе»
      Alert.alert('Выплатить зарплату', e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setPayrollBusy(false);
    }
  };

  if (loading && !finance) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!finance) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Не удалось загрузить финансы'}</Text>
        <Button title="Повторить" variant="ghost" small onPress={() => void load()} />
      </View>
    );
  }

  const canManage = finance.canManage;
  const myTotal = finance.transactions
    .filter((tx) => tx.kind === 'salary')
    .reduce((sum, tx) => sum + tx.amount, 0);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {canManage ? (
        <>
          {/* ---- казначейство ---- */}
          <View style={styles.treasuryCard}>
            <Text style={styles.treasuryLabel}>Казначейство организации</Text>
            <Text style={styles.treasuryValue}>{rub(finance.balance)}</Text>
            <Text style={styles.treasuryHint}>
              Ваш личный баланс: {rub(user?.balance ?? 0)} · демо-режим
            </Text>
            <View style={styles.rowButtons}>
              <Button
                title="Пополнить казначейство"
                icon="plus"
                onPress={openDeposit}
                style={{ flex: 1 }}
              />
              <Button
                title="Выплатить зарплату"
                variant="ghost"
                icon="send"
                onPress={openPayroll}
                style={{ flex: 1 }}
              />
            </View>
          </View>

          <DemoBanner />

          {/* ---- выплачено ---- */}
          <Text style={styles.sectionTitle}>Выплачено</Text>
          {finance.payrollTotals.length === 0 ? (
            <Empty text="Зарплата ещё не выплачивалась" />
          ) : (
            finance.payrollTotals.map((item) => (
              <View key={item.user.id} style={styles.totalRow}>
                <Avatar name={item.user.displayName} color={item.user.avatarColor} size={32} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.totalName} numberOfLines={1}>
                    {item.user.displayName}
                    {item.user.id === meId ? ' (вы)' : ''}
                  </Text>
                  <Text style={styles.totalMeta} numberOfLines={1}>
                    @{item.user.username}
                  </Text>
                </View>
                <Text style={styles.totalValue}>{rub(item.total)}</Text>
              </View>
            ))
          )}

          {/* ---- история операций казначейства ---- */}
          <Text style={styles.sectionTitle}>История операций</Text>
          {finance.transactions.length === 0 ? (
            <Empty text="Операций пока нет" />
          ) : (
            finance.transactions.map((tx) => (
              <PaymentRow
                key={tx.id}
                kind={tx.kind}
                amount={tx.amount}
                createdAt={tx.createdAt}
                note={tx.note}
                {...txRowProps(tx, meId, canManage)}
              />
            ))
          )}
        </>
      ) : (
        <>
          {/* ---- обычный участник: только свои начисления ---- */}
          <View style={styles.treasuryCard}>
            <Text style={styles.treasuryLabel}>Мои начисления</Text>
            <Text style={styles.treasuryValue}>{rub(myTotal)}</Text>
            <Text style={styles.treasuryHint}>Начисления от этой организации · демо-режим</Text>
          </View>

          <DemoBanner />

          <Text style={styles.sectionTitle}>История начислений</Text>
          {finance.transactions.length === 0 ? (
            <Empty text="Начислений пока нет" />
          ) : (
            finance.transactions.map((tx) => (
              <PaymentRow
                key={tx.id}
                kind={tx.kind}
                amount={tx.amount}
                createdAt={tx.createdAt}
                note={tx.note}
                {...txRowProps(tx, meId, canManage)}
              />
            ))
          )}
        </>
      )}

      <View style={styles.reload}>
        <Button title="Обновить" variant="ghost" small icon="refresh-cw" onPress={() => void load()} />
      </View>

      {/* ---- модалка пополнения казначейства ---- */}
      <AppModal
        visible={depositOpen}
        title="Пополнить казначейство"
        onClose={() => setDepositOpen(false)}
        footer={
          <Button
            title={
              parseInt(depositAmount.replace(/\D/g, ''), 10) > 0
                ? `Пополнить на ${rub(parseInt(depositAmount.replace(/\D/g, ''), 10))}`
                : 'Пополнить'
            }
            loading={depositBusy}
            onPress={() => void submitDeposit()}
          />
        }>
        <DemoBanner />
        <Field
          label="Сумма, ₽"
          value={depositAmount}
          onChangeText={(v) => setDepositAmount(v.replace(/\D/g, '').slice(0, 9))}
          placeholder="1 – 100 000 000"
          keyboardType="number-pad"
          maxLength={9}
        />
        <Text style={styles.modalHint}>
          Списание с вашего личного баланса: {rub(user?.balance ?? 0)}
        </Text>
        <Text style={styles.modalHint}>В казначействе: {rub(finance.balance)}</Text>
      </AppModal>

      {/* ---- модалка выплаты зарплаты ---- */}
      <AppModal
        visible={payrollOpen}
        title="Выплатить зарплату"
        onClose={() => setPayrollOpen(false)}
        footer={
          <Button
            title={
              parseInt(payrollAmount.replace(/\D/g, ''), 10) > 0
                ? `Выплатить ${rub(parseInt(payrollAmount.replace(/\D/g, ''), 10))}`
                : 'Выплатить'
            }
            loading={payrollBusy}
            onPress={() => void submitPayroll()}
          />
        }>
        <DemoBanner />

        <Text style={styles.modalLabel}>Сотрудник</Text>
        {members.map((member) => {
          const active = member.user.id === payrollUserId;
          return (
            <Pressable
              key={member.user.id}
              onPress={() => setPayrollUserId(member.user.id)}
              style={({ pressed }) => [
                styles.memberRow,
                active && styles.memberRowActive,
                pressed && { opacity: 0.75 },
              ]}>
              <Avatar name={member.user.displayName} color={member.user.avatarColor} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.totalName} numberOfLines={1}>
                  {member.user.displayName}
                  {member.user.id === meId ? ' (вы)' : ''}
                </Text>
                <Text style={styles.totalMeta} numberOfLines={1}>
                  @{member.user.username}
                </Text>
              </View>
              {active ? <Feather name="check" size={16} color={colors.accent} /> : null}
            </Pressable>
          );
        })}

        <Field
          label="Сумма, ₽"
          value={payrollAmount}
          onChangeText={(v) => setPayrollAmount(v.replace(/\D/g, '').slice(0, 9))}
          placeholder="1 – 100 000 000"
          keyboardType="number-pad"
          maxLength={9}
        />
        <Field
          label="Комментарий (необязательно)"
          value={payrollNote}
          onChangeText={setPayrollNote}
          placeholder="Оклад за октябрь / аванс"
          maxLength={300}
        />
        <Text style={styles.modalHint}>В казначействе: {rub(finance.balance)}</Text>
      </AppModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 10,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  treasuryCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    gap: 6,
    alignItems: 'center',
  },
  treasuryLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  treasuryValue: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '700',
    marginVertical: 4,
  },
  treasuryHint: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
  rowButtons: {
    flexDirection: 'row',
    gap: 8,
    alignSelf: 'stretch',
    marginTop: 8,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 6,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  totalName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  totalMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  totalValue: {
    color: colors.ok,
    fontSize: 14,
    fontWeight: '700',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 2,
  },
  memberRowActive: {
    borderColor: colors.accent,
  },
  modalLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  modalHint: {
    color: colors.muted,
    fontSize: 12,
  },
  reload: {
    alignItems: 'center',
    paddingTop: 4,
  },
});
