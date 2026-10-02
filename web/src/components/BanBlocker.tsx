/**
 * Экран для забаненного (SPEC v7 §35): по событию `user:banned {byName, reason}`
 * — затемняющее окно на весь экран поверх всего интерфейса. Крестика нет;
 * единственный выход — кнопка «Выйти» (сброс токена → страница входа).
 */

import { useApp } from '../store';

export function BanBlocker() {
  const { banNotice, logout } = useApp();
  if (!banNotice) return null;

  return (
    <div
      className="ban-blocker"
      role="alertdialog"
      aria-modal="true"
      aria-label="Аккаунт заблокирован"
    >
      <div className="ban-blocker-card">
        <div className="ban-blocker-warn">⚠️ Внимание!</div>
        <p className="ban-blocker-text">
          Вас забанил(а) <strong>{banNotice.byName}</strong>.
        </p>
        <p className="ban-blocker-reason">Причина: {banNotice.reason}</p>
        <button className="btn btn-danger-filled ban-blocker-exit" onClick={logout}>
          Выйти
        </button>
      </div>
    </div>
  );
}
