import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Empty } from '@/components/controls';
import { AuthGuard, ScreenHeader } from '@/components/screen';
import { DemoBanner } from '@/components/wallet/demo-banner';
import { PaymentRow } from '@/components/wallet/payment-row';
import { TopupModal } from '@/components/wallet/topup-modal';
import { TransferModal } from '@/components/wallet/transfer-modal';
import { walletApi } from '@/lib/endpoints';
import { rub } from '@/lib/format';
import { colors, radius } from '@/lib/theme';
import { WalletPayment } from '@/lib/types';
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
        demo: true,
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

  const load = useCallback(async () => {
    try {
      const res = await walletApi.get();
      setData({ balance: res.balance, payments: res.payments });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить кошелёк');
    } finally {
      setLoading(false);
    }
  }, []);

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

  const balance = data?.balance ?? user?.balance ?? 0;
  const payments = data?.payments ?? [];

  const onTopup = (amount: number) => {
    setTopupOpen(false);
    void load();
    void refreshMe();
    show(`Пополнение: +${rub(amount)}`);
  };

  const onTransfer = (amount: number, to: { displayName: string }) => {
    setTransferOpen(false);
    void load();
    void refreshMe();
    show(`Перевод: −${rub(amount)} → ${to.displayName}`);
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
        subtitle="Демо-режим · реальные деньги не участвуют"
        onBack={() => router.back()}
      />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {error && !data ? <Text style={styles.error}>{error}</Text> : null}

        {/* ---- баланс ---- */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Баланс</Text>
          <Text style={styles.balanceValue}>{rub(balance)}</Text>
          <View style={styles.rowButtons}>
            <Button
              title="Пополнить"
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

        <DemoBanner />

        {/* ---- история операций ---- */}
        <Text style={styles.sectionTitle}>История операций</Text>

        {error && data ? <Text style={styles.error}>{error}</Text> : null}

        {!error && payments.length === 0 ? (
          <Empty text={'Операций пока нет\nПополните кошелёк, чтобы начать'} />
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
        onClose={() => setTopupOpen(false)}
        onDone={onTopup}
      />
      <TransferModal
        visible={transferOpen}
        balance={balance}
        meId={user?.id ?? ''}
        onClose={() => setTransferOpen(false)}
        onDone={onTransfer}
      />
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
  reload: {
    alignItems: 'center',
    paddingTop: 4,
  },
});
