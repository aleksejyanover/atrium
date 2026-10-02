import { useRef, useState } from 'react';

import { BanOverlay } from '@/components/ban-overlay';
import { rub } from '@/lib/format';
import { useAuth } from '@/state/auth';
import { useOrgs } from '@/state/orgs';
import { useSocketEvent } from '@/state/socket';
import { useToast } from '@/state/toast';

/**
 * Глобальная обработка новых socket-событий SPEC v2/v3/v4/v8 (§13, §18, §24, §35):
 * application:new/update, document:new/update, wallet:updated → тосты +
 * обновление бейджей и списков без перезагрузки; user:banned → блокирующее окно.
 *
 * Монтируется внутри ToastProvider; входящие приглашения (invite:new)
 * обрабатываются на экранах — здесь их нет, чтобы не дублировать тосты.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { show } = useToast();
  const { user, refreshMe, logout } = useAuth();
  const { refresh } = useOrgs();

  // SPEC v8 §35: блокирующее окно бана — показывается один раз на сессию,
  // сбрасывается при выходе по кнопке «Выйти» (единственный путь закрытия).
  const [ban, setBan] = useState<{ byName: string; reason: string } | null>(null);
  const banShownRef = useRef(false);

  useSocketEvent('user:banned', (payload) => {
    if (banShownRef.current) return;
    banShownRef.current = true;
    setBan({ byName: payload.byName, reason: payload.reason });
  });

  useSocketEvent('application:new', (payload) => {
    const name = payload.org?.name;
    show(name ? `Новое заявление в «${name}»` : 'Новое заявление');
    void refresh();
  });

  useSocketEvent('application:update', (payload) => {
    void refresh();
    if (!payload.application || payload.application.targetUserId !== user?.id) return;
    switch (payload.application.status) {
      case 'approved':
        show('Заявление принято');
        break;
      case 'rejected':
        show('Заявление отклонено');
        break;
      case 'canceled':
        show('Заявление отозвано');
        break;
      default:
        show('Статус заявления обновлён');
    }
  });

  useSocketEvent('document:new', (payload) => {
    const name = payload.org?.name;
    show(name ? `Вам отправлен договор об увольнении «${name}»` : 'Вам отправлен договор об увольнении');
    void refresh();
  });

  useSocketEvent('document:update', (payload) => {
    void refresh();
    if (!payload.document || payload.document.targetUserId !== user?.id) return;
    switch (payload.document.status) {
      case 'signed':
        show('Договор об увольнении подписан');
        break;
      case 'rejected':
        show('Вы оспорили договор об увольнении');
        break;
      case 'canceled':
        show('Увольнение отменено');
        break;
      case 'terminated':
        show('Членство расторгнуто в одностороннем порядке');
        break;
      default:
        show('Статус договора об увольнении обновлён');
    }
  });

  // SPEC v4 §24/§25: баланс кошелька обновляем в реальном времени.
  // Экран кошелька и «Финансы организации» слушают событие сами и перечитывают
  // свои данные; здесь — глобальный баланс (profile) + тост получателю.
  useSocketEvent('wallet:updated', (payload) => {
    void refreshMe();
    const amount = payload.amount;
    if (typeof amount !== 'number') return;
    if (payload.reason === 'salary') {
      show(`💸 Начислена зарплата: +${rub(amount)}`);
    } else if (payload.reason === 'transfer' || payload.from) {
      show(`💸 Перевод: +${rub(amount)}${payload.from ? ` от ${payload.from.displayName}` : ''}`);
    }
    // topup / treasury_deposit: тост показывает сам экран после своего действия,
    // здесь только обновляем баланс, чтобы не дублировать.
  });

  return (
    <>
      {children}
      {ban ? (
        <BanOverlay
          byName={ban.byName}
          reason={ban.reason}
          onExit={() => {
            // Выход: сбрасываем окно и флаг, затем токен → экран входа.
            banShownRef.current = false;
            setBan(null);
            void logout();
          }}
        />
      ) : null}
    </>
  );
}
