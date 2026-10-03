import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Empty } from '@/components/controls';
import { AuthGuard, ScreenHeader } from '@/components/screen';
import { BankAccountModal } from '@/components/wallet/bank-account-modal';
import { BankTopupModal } from '@/components/wallet/bank-topup-modal';
import { BankWithdrawModal } from '@/components/wallet/bank-withdraw-modal';
import { PaymentRow } from '@/components/wallet/payment-row';
import { TopupModal } from '@/components/wallet/topup-modal';
import { TransferModal } from '@/components/wallet/transfer-modal';
import { walletApi } from '@/lib/endpoints';
import { formatBalance, rub } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import { BankAccount, BankOp, WalletPayment } from '@/lib/types';
import { useAuth } from '@/state/auth';
import { useSocketEvent } from '@/state/socket';
import { useToast } from '@/state/toast';

export default function WalletRoute() {
  return (
    <AuthGuard>
      <WalletScreen />
    </AuthGuard>
  );
}

/** Строка истории кошелька → пропсы PaymentRow (SPEC v4 §24). */
function walletRowProps(p: WalletPayment) {
  const incoming = p.direction === 'in';
  const cp = p.counterparty;
  const cpUser = cp && 'user' in cp ? cp.user : null;
  const cpOrg = cp && 'org' in cp ? cp.org : null;

  switch (p.kind) {
    case 'topup':
      return {
        title: 'Пополнение с карты',
        meta: p.cardMask ? `Карта ${p.cardMask}` : null,
      };
    case 'transfer':
      return incoming
        ? {
            title: cpUser?.displayName ?? 'Перевод',
            meta: cpUser ? `от @${cpUser.username}` : 'Входящий перевод',
          }
        : {
            title: cpUser?.displayName ?? 'Перевод',
            meta: cpUser ? `@${cpUser.username}` : 'Исходящий перевод',
          };
    case 'salary':
      return {
        title: 'Зарплата',
        meta: cpOrg ? `Организация «${cpOrg.name}»` : null,
      };
    case 'treasury_deposit':
      return {
        title: 'Казначейство организации',
        meta: cpOrg ? `Организация «${cpOrg.name}»` : null,
      };
    case 'bank_withdraw':
      return {
        title: 'Вывод на банковскую карту',
        meta: p.cardMask ? `Карта ${p.cardMask}` : null,
      };
    case 'bank_topup':
      return {
        title: 'Зачисление с банковской карты',
        meta: p.cardMask ? `Карта ${p.cardMask}` : null,
      };
  }
}

function WalletScreen() {
  const router = useRouter();
  const { show } = useToast();
  const { user, refreshMe } = useAuth();

  const [data, setData] = useState<{ balance: number; payments: WalletPayment[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topupOpen, setTopupOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  // банковский счёт (SPEC v9 §40)
  const [bank, setBank] = useState<{ account: BankAccount | null; ops: BankOp[] } | null>(null);
  const [bankLinkOpen, setBankLinkOpen] = useState(false);
  const [bankWithdrawOpen, setBankWithdrawOpen] = useState(false);
  const [bankTopupOpen, setBankTopupOpen] = useState(false);

  const loadBank = useCallback(async () => {
    try {
      setBank(await walletApi.bank());
    } catch {
      // банковский блок не должен ломать экран кошелька — пустое состояние
      setBank({ account: null, ops: [] });
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await walletApi.get();
      // Обычное число и у владельца (SPEC v6 §32); ?? 0 — защита на время перехода бэкенда.
      setData({ balance: res.balance ?? 0, payments: res.payments });
      setError(null);
      void loadBank();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить кошелёк');
    } finally {
      setLoading(false);
    }
  }, [loadBank]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // realtime: баланс обновился извне (зарплата, перевод, пополнение)
  useSocketEvent('wallet:updated', () => {
    void load();
    void refreshMe();
  });

  // Баланс владельца — обычное число (SPEC v6 §32).
  const isOwner = !!user?.isOwner;
  const balance: number = data ? data.balance : (user?.balance ?? 0);
  const payments = data?.payments ?? [];

  const onTopup = (amount: number) => {
    setTopupOpen(false);
    void load();
    void refreshMe();
    show(`Операция выполнена: +${rub(amount)}`);
  };

  const onTransfer = (amount: number, to: { displayName: string }) => {
    setTransferOpen(false);
    void load();
    void refreshMe();
    show(`Операция выполнена: −${rub(amount)} → ${to.displayName}`);
  };

  const onBankLinked = (account: BankAccount) => {
    setBankLinkOpen(false);
    void loadBank();
    show(`Счёт привязан: ${account.bank} ${account.numberMasked}`);
  };

  const onBankWithdraw = (amount: number) => {
    setBankWithdrawOpen(false);
    void load();
    void refreshMe();
    show(`Перевод на карту выполнен: −${rub(amount)}`);
  };

  const onBankTopup = (amount: number) => {
    setBankTopupOpen(false);
    void load();
    void refreshMe();
    show(`Средства зачислены: +${rub(amount)}`);
  };

  const unlinkAccount = () => {
    if (!bank?.account) return;
    Alert.alert(
      'Отвязать счёт',
      `${bank.account.bank} ${bank.account.numberMasked} будет отвязан. История операций сохранится.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отвязать',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await walletApi.unlinkBankAccount();
                await loadBank();
                show('Банковский счёт отвязан');
              } catch (e) {
                Alert.alert(
                  'Отвязать счёт',
                  e instanceof Error ? e.message : 'Не удалось отвязать счёт',
                );
              }
            })();
          },
        },
      ],
    );
  };

  if (loading && !data) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Кошелёк" onBack={() => router.back()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Кошелёк"
        subtitle="Баланс и история операций"
        onBack={() => router.back()}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error && !data ? <Text style={styles.error}>{error}</Text> : null}

        {/* ---- баланс ---- */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Баланс</Text>
          <Text style={[styles.balanceValue, isOwner && styles.balanceValueOwner]}>
            {formatBalance(balance)}
          </Text>
          <View style={styles.rowButtons}>
            <Button
              title="Пополнить счёт"
              icon="plus"
              onPress={() => setTopupOpen(true)}
              style={{ flex: 1 }}
            />
            <Button
              title="Перевести"
              variant="ghost"
              icon="send"
              onPress={() => setTransferOpen(true)}
              style={{ flex: 1 }}
            />
          </View>
        </View>

        {/* ---- банковский счёт (SPEC v9 §40) ---- */}
        <Text style={styles.sectionTitle}>Банковский счёт</Text>

        {bank === null ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: 8 }} />
        ) : bank.account === null ? (
          <View style={styles.bankBox}>
            <Text style={styles.bankHint}>
              Привяжите карту, чтобы выводить деньги на свой банковский счёт и пополнять счёт в
              приложении с неё
            </Text>
            <Button title="Привязать карту" icon="credit-card" onPress={() => setBankLinkOpen(true)} />
          </View>
        ) : (
          <View style={styles.bankBox}>
            <View style={styles.bankRow}>
              <Text style={styles.bankLabel}>Карта</Text>
              <Text style={styles.bankValue}>
                {bank.account.bank} · {bank.account.numberMasked}
              </Text>
            </View>
            <View style={styles.bankRow}>
              <Text style={styles.bankLabel}>Держатель</Text>
              <Text style={styles.bankValue}>{bank.account.holder}</Text>
            </View>

            <View style={styles.bankButtons}>
              <Button
                title="Вывести на карту"
                icon="arrow-up-right"
                onPress={() => setBankWithdrawOpen(true)}
                style={{ flex: 1 }}
              />
              <Button
                title="Пополнить с карты"
                variant="ghost"
                icon="plus"
                onPress={() => setBankTopupOpen(true)}
                style={{ flex: 1 }}
              />
            </View>
            <Button title="Отвязать счёт" variant="ghost" small onPress={unlinkAccount} />

            {bank.ops.length > 0 ? (
              <View style={{ marginTop: 8, gap: 6 }}>
                <Text style={styles.bankSubTitle}>Банковские операции</Text>
                {bank.ops.slice(0, 3).map((op) => (
                  <View key={op.id} style={styles.bankOpRow}>
                    <Text style={styles.bankOpTitle} numberOfLines={1}>
                      {op.type === 'withdraw' ? 'Вывод' : 'Пополнение'} · •••• {op.accountLast4}
                    </Text>
                    <Text style={styles.bankOpAmount}>
                      {op.type === 'withdraw' ? '−' : '+'}
                      {rub(op.amount)} · Исполнено
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        )}

        {/* ---- история операций ---- */}
        <Text style={styles.sectionTitle}>История операций</Text>

        {error && data ? <Text style={styles.error}>{error}</Text> : null}

        {!error && payments.length === 0 ? (
          <Empty text={'Операций пока нет\nПополните счёт, чтобы начать'} />
        ) : null}

        {payments.map((p) => (
          <PaymentRow
            key={p.id}
            kind={p.kind}
            amount={p.amount}
            incoming={p.direction === 'in'}
            createdAt={p.createdAt}
            note={p.note}
            {...walletRowProps(p)}
          />
        ))}

        <View style={styles.reload}>
          <Button
            title="Обновить"
            variant="ghost"
            small
            icon="refresh-cw"
            onPress={() => void load()}
          />
        </View>
      </ScrollView>

      <TopupModal
        visible={topupOpen}
        balance={balance}
        isOwner={isOwner}
        onClose={() => setTopupOpen(false)}
        onDone={onTopup}
      />
      <TransferModal
        visible={transferOpen}
        balance={balance}
        meId={user?.id ?? ''}
        isOwner={isOwner}
        onClose={() => setTransferOpen(false)}
        onDone={onTransfer}
      />
      <BankAccountModal
        visible={bankLinkOpen}
        onClose={() => setBankLinkOpen(false)}
        onDone={onBankLinked}
      />
      {bank?.account ? (
        <>
          <BankWithdrawModal
            visible={bankWithdrawOpen}
            account={bank.account}
            balance={balance}
            isOwner={isOwner}
            onClose={() => setBankWithdrawOpen(false)}
            onDone={onBankWithdraw}
          />
          <BankTopupModal
            visible={bankTopupOpen}
            account={bank.account}
            onClose={() => setBankTopupOpen(false)}
            onDone={onBankTopup}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 48,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  balanceCard: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 18,
    gap: 6,
    alignItems: 'center',
  },
  balanceLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  balanceValue: {
    color: colors.text,
    fontSize: 40,
    fontWeight: '700',
    marginVertical: 6,
  },
  balanceValueOwner: {
    color: colors.gold,
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
  bankBox: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
    gap: 8,
  },
  bankHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  bankLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
  },
  bankValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  bankButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  bankSubTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  bankOpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: colors.panel2,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  bankOpTitle: {
    color: colors.text,
    fontSize: 13,
    flexShrink: 1,
  },
  bankOpAmount: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  reload: {
    alignItems: 'center',
    paddingTop: 4,
  },
});
