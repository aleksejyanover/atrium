/** «Кошелёк»: баланс, пополнение счёта, переводы и история операций (SPEC v4 §24, v5 §30, v6 §32). */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../store';
import {
  balanceText,
  formatRub,
  paymentKindLabel,
  type BankAccount,
  type BankOp,
  type User,
  type WalletPayment,
} from '../types';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { OwnerBadge } from './OwnerBadge';
import {
  ArrowDownLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  CreditCardIcon,
  MenuIcon,
  SearchIcon,
  WalletIcon,
  XIcon,
} from './icons';

interface ScreenProps {
  onOpenNav: () => void;
}

const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** «•••• 4242» → «Карта •••• 4242» (нейтральная банковская подпись, SPEC v5 §30). */
function cardMaskLabel(mask: string): string {
  const trimmed = mask.trim();
  return /^Карта/i.test(trimmed) ? trimmed : `Карта ${trimmed}`;
}

/** «4242 4242 4242 4242» → groups of 4 digits, max 16 digits. */
function maskCardInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function toAmount(value: string): number | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/** Ввод номера банковского счёта: все-цифры → группы по4 (до16), иначе IBAN (до20). */
function maskBankInput(value: string): string {
  const clean = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 20);
  if (/^\d*$/.test(clean)) return clean.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
  return clean;
}

/**16-значная карта или20-символьный IBAN (как на сервере). */
function isValidAccountNumber(value: string): boolean {
  const clean = value.replace(/[^A-Za-z0-9]/g, '');
  return /^\d{16}$/.test(clean) || /^[A-Za-z]{2}\d{2}[A-Za-z0-9]{18}$/.test(clean);
}

/* ============================================================
   Пополнение счёта
   ============================================================ */

const TOPUP_CHIPS = [500, 1000, 5000];

export function TopupModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (balance: number) => void;
}) {
  const { toast, user } = useApp();
  // SPEC v6 §32: у владельца свой пароль карты и снят верхний лимит суммы
  const isOwner = user?.isOwner === true;
  const [amount, setAmount] = useState('');
  const [card, setCard] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = toAmount(amount);
  const cardDigits = card.replace(/\D/g, '');

  const submit = async () => {
    if (value === null || value < (isOwner ? 1 : 100) || (!isOwner && value > 500000)) {
      setError(
        isOwner
          ? 'Сумма пополнения: положительное целое число'
          : 'Сумма пополнения: от 100 до 500 000 ₽',
      );
      return;
    }
    if (cardDigits.length !== 16) {
      setError('Номер карты: 16 цифр');
      return;
    }
    if (isOwner && pin.length !== 4) {
      setError('Пароль карты: 4 цифры');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.walletTopup(value, cardDigits, isOwner ? pin : undefined);
      toast(`Операция выполнена: +${formatRub(value)}`, 'success');
      onDone(res.balance);
      onClose();
    } catch (e) {
      // 400 «Неверный пароль карты» (SPEC v6 §32) показываем прямо в модалке
      setError(e instanceof Error ? e.message : 'Не удалось пополнить счёт');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Пополнить счёт"
      subtitle="Деньги зачисляются мгновенно"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Пополнение…' : 'Пополнить'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Сумма пополнения, ₽</label>
        <input
          className="input"
          inputMode="numeric"
          value={amount}
          placeholder="1000"
          onChange={(e) =>
            setAmount(e.target.value.replace(/\D/g, '').slice(0, isOwner ? 12 : 6))
          }
          autoFocus
        />
        <div className="chips">
          {TOPUP_CHIPS.map((c) => (
            <button
              key={c}
              className={value === c ? 'chip active' : 'chip'}
              onClick={() => setAmount(String(c))}
            >
              {formatRub(c)}
            </button>
          ))}
        </div>
        {isOwner && <span className="hint">Верхний лимит суммы для владельца не действует</span>}
      </div>

      <div className="field">
        <label>Номер карты</label>
        <input
          className="input card-input"
          inputMode="numeric"
          autoComplete="cc-number"
          value={card}
          placeholder="0000 0000 0000 0000"
          onChange={(e) => setCard(maskCardInput(e.target.value))}
        />
        <span className="hint">Привяжите карту для быстрых пополнений счёта</span>
      </div>

      {isOwner && (
        <div className="field">
          <label>Пароль карты</label>
          <input
            className="input card-input"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={pin}
            placeholder="••••"
            maxLength={4}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <span className="hint">Пароль запрашивается при каждой операции с деньгами</span>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================
   Перевод пользователю
   ============================================================ */

export function TransferModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (balance: number) => void;
}) {
  const { toast, user } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [picked, setPicked] = useState<User | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* debounce-поиск пользователей (GET /api/users/search) */
  useEffect(() => {
    if (picked) return;
    const query = q.trim();
    if (query.length < 1) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api
        .searchUsers(query)
        .then((users) => setResults(users.filter((u) => u.id !== user?.id)))
        .catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, picked, user]);

  const value = toAmount(amount);
  // SPEC v6 §32: владелец платит паролем карты; его исходящие операции
  // баланс не уменьшают, а верхний лимит суммы снят
  const isOwner = user?.isOwner === true;
  const balance = user?.balance ?? 0;
  const rest = isOwner ? balance : value !== null ? balance - value : balance;

  const submit = async () => {
    if (!picked) {
      setError('Выберите получателя');
      return;
    }
    if (value === null || value < 1 || (!isOwner && value > 500000)) {
      setError(
        isOwner
          ? 'Сумма перевода: положительное целое число'
          : 'Сумма перевода: от 1 до 500 000 ₽',
      );
      return;
    }
    if (isOwner && pin.length !== 4) {
      setError('Пароль карты: 4 цифры');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.walletTransfer(
        picked.id,
        value,
        note.trim() || undefined,
        isOwner ? pin : undefined,
      );
      toast(`Перевод: ${formatRub(value)} → ${picked.displayName}`, 'success');
      onDone(res.balance);
      onClose();
    } catch (e) {
      // 409 → «Недостаточно средств» (SPEC v4 §24); 400 → «Неверный пароль карты»
      if (e instanceof ApiError && e.status === 409) setError('Недостаточно средств');
      else setError(e instanceof Error ? e.message : 'Не удалось выполнить перевод');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Перевести"
      subtitle="Перевод между счетами Atrium"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn-primary"
            disabled={!picked || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Отправка…' : 'Перевести'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Получатель</label>
        <div className="input-with-icon">
          <SearchIcon size={15} />
          <input
            className="input"
            value={picked ? `@${picked.username}` : q}
            disabled={picked !== null}
            placeholder="Имя или username…"
            onChange={(e) => {
              setQ(e.target.value);
              setPicked(null);
            }}
          />
          {picked && (
            <button
              className="icon-btn input-clear"
              title="Сменить получателя"
              onClick={() => {
                setPicked(null);
                setQ('');
              }}
            >
              <XIcon size={14} />
            </button>
          )}
        </div>
        {!picked && results.length > 0 && (
          <div className="search-results">
            {results.map((u) => (
              <button key={u.id} className="search-result" onClick={() => setPicked(u)}>
                <Avatar name={u.displayName} color={u.avatarColor} size={26} />
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  {u.displayName} <span className="muted">@{u.username}</span>
                </span>
                {u.isOwner && <OwnerBadge />}
              </button>
            ))}
          </div>
        )}
        {picked?.isOwner && (
          <div className="owner-hint">Этот пользователь — карточка владельца</div>
        )}
        {!picked && q.trim().length > 0 && results.length === 0 && (
          <div className="hint">Ничего не найдено</div>
        )}
      </div>

      <div className="field">
        <label>Сумма, ₽</label>
        <input
          className="input"
          inputMode="numeric"
          value={amount}
          placeholder="500"
          onChange={(e) =>
            setAmount(e.target.value.replace(/\D/g, '').slice(0, isOwner ? 12 : 6))
          }
        />
        <span className="hint">Доступно: {balanceText(user?.balance)}</span>
      </div>

      <div className="field">
        <label>Комментарий (необязательно)</label>
        <input
          className="input"
          value={note}
          maxLength={300}
          placeholder="За что / за что именно"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {isOwner && (
        <div className="field">
          <label>Пароль карты</label>
          <input
            className="input card-input"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={pin}
            placeholder="••••"
            maxLength={4}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <span className="hint">Пароль запрашивается при каждой операции с деньгами</span>
        </div>
      )}

      {picked && value !== null && value > 0 && (
        <div className="summary-box">
          <div className="info-kv">
            <span className="k">Получатель</span>
            <span className="v" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {picked.displayName}
              {picked.isOwner && <OwnerBadge />}
            </span>
          </div>
          <div className="info-kv">
            <span className="k">Сумма</span>
            <span className="v">{formatRub(value)}</span>
          </div>
          <div className="info-kv">
            <span className="k">Комментарий</span>
            <span className="v">{note.trim() ? note.trim() : '—'}</span>
          </div>
          <div className="info-kv">
            <span className="k">Баланс после перевода</span>
            <span className="v">{formatRub(Math.max(0, rest))}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================
   Вывод на банковскую карту (SPEC v9 §40)
   ============================================================ */

export function BankWithdrawModal({
  account,
  onClose,
  onDone,
}: {
  account: BankAccount;
  onClose: () => void;
  onDone: (balance: number) => void;
}) {
  const { toast, user } = useApp();
  const isOwner = user?.isOwner === true;
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = toAmount(amount);
  const balance = user?.balance ?? 0;

  const submit = async () => {
    if (value === null || value < 1) {
      setError('Сумма перевода: положительное целое число');
      return;
    }
    if (!isOwner && value > balance) {
      setError('Недостаточно средств');
      return;
    }
    if (isOwner && pin.length !== 4) {
      setError('Пароль карты: 4 цифры');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.bankWithdraw(value, isOwner ? pin : undefined);
      toast(`Перевод на карту выполнен: −${formatRub(value)}`, 'success');
      onDone(res.balance);
      onClose();
    } catch (e) {
      // 400 «Неверный пароль карты» (§32–33), 409 «Недостаточно средств»
      if (e instanceof ApiError && e.status === 409) setError('Недостаточно средств');
      else setError(e instanceof Error ? e.message : 'Не удалось выполнить перевод');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Вывести на карту"
      subtitle="Перевод на привязанный банковский счёт"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Перевод…' : 'Перевести'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Сумма, ₽</label>
        <input
          className="input"
          inputMode="numeric"
          value={amount}
          placeholder="1000"
          autoFocus
          onChange={(e) =>
            setAmount(e.target.value.replace(/\D/g, '').slice(0, isOwner ? 12 : 6))
          }
        />
        {!isOwner && <span className="hint">Доступно: {balanceText(balance)}</span>}
      </div>

      <div className="summary-box">
        <div className="info-kv">
          <span className="k">Карта получателя</span>
          <span className="v">
            {account.bank} · {account.numberMasked}
          </span>
        </div>
        <div className="info-kv">
          <span className="k">Держатель</span>
          <span className="v">{account.holder}</span>
        </div>
      </div>

      {isOwner && (
        <div className="field">
          <label>Пароль карты</label>
          <input
            className="input card-input"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={pin}
            placeholder="••••"
            maxLength={4}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          <span className="hint">Пароль запрашивается при каждой операции с деньгами</span>
        </div>
      )}
    </Modal>
  );
}

/* ============================================================
   Пополнение с привязанной банковской карты (SPEC v9 §40)
   ============================================================ */

export function BankTopupModal({
  account,
  onClose,
  onDone,
}: {
  account: BankAccount;
  onClose: () => void;
  onDone: (balance: number) => void;
}) {
  const { toast } = useApp();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = toAmount(amount);

  const submit = async () => {
    if (value === null || value < 1 || value > 5000000) {
      setError('Сумма пополнения: от 1 до 5 000 000 ₽');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.bankTopup(value);
      toast(`Средства зачислены: +${formatRub(value)}`, 'success');
      onDone(res.balance);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось пополнить счёт');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Пополнить с карты"
      subtitle="Зачисление на счёт в приложении"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Зачисление…' : 'Пополнить'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Сумма, ₽</label>
        <input
          className="input"
          inputMode="numeric"
          value={amount}
          placeholder="1000"
          autoFocus
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 7))}
        />
        <span className="hint">От1 до5 000 000 ₽ за одну операцию</span>
      </div>

      <div className="summary-box">
        <div className="info-kv">
          <span className="k">Карта списания</span>
          <span className="v">
            {account.bank} · {account.numberMasked}
          </span>
        </div>
        <div className="info-kv">
          <span className="k">Держатель</span>
          <span className="v">{account.holder}</span>
        </div>
      </div>
    </Modal>
  );
}

/* ============================================================
   Строка истории операций
   ============================================================ */

function counterpartyLabel(p: WalletPayment): string | null {
  const cp = p.counterparty;
  if (!cp) return null;
  if ('user' in cp) return cp.user.displayName;
  return `«${cp.org.name}»`;
}

function kindIcon(p: WalletPayment) {
  if (p.kind === 'topup') return <CreditCardIcon size={16} />;
  if (p.kind === 'transfer') return <ArrowRightIcon size={16} />;
  if (p.kind === 'salary') return <ArrowDownLeftIcon size={16} />;
  if (p.kind === 'bank_withdraw') return <ArrowUpRightIcon size={16} />;
  if (p.kind === 'bank_topup') return <ArrowDownLeftIcon size={16} />;
  return <ArrowUpRightIcon size={16} />;
}

function PayRow({ payment }: { payment: WalletPayment }) {
  const kindLabel = paymentKindLabel(payment.kind);
  const cp = counterpartyLabel(payment);
  const title = cp ?? kindLabel;
  const showKind = title !== kindLabel;
  const isIn = payment.direction === 'in';
  return (
    <div className="pay-row">
      <span className={isIn ? 'pay-icon in' : 'pay-icon out'} aria-hidden>
        {kindIcon(payment)}
      </span>
      <div className="pay-main">
        <div className="pay-title">{title}</div>
        <div className="pay-sub">
          {showKind ? `${kindLabel} · ` : ''}
          {timeFmt.format(payment.createdAt)}
          {payment.note ? ` · ${payment.note}` : ''}
        </div>
        {payment.cardMask && (
          <div className="pay-badges">
            <span className="pay-mask">{cardMaskLabel(payment.cardMask)}</span>
          </div>
        )}
      </div>
      <div className="pay-right">
        <span className={isIn ? 'pay-amount in' : 'pay-amount out'}>
          {isIn ? '+' : '−'}
          {formatRub(payment.amount)}
        </span>
      </div>
    </div>
  );
}

/* ============================================================
   Экран «Кошелёк»
   ============================================================ */

export function WalletScreen({ onOpenNav }: ScreenProps) {
  const { user, socket, updateUser, toast } = useApp();
  const [balance, setBalance] = useState<number | null>(user?.balance ?? null);
  const [payments, setPayments] = useState<WalletPayment[] | null>(null);
  const [showTopup, setShowTopup] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);

  // SPEC v9 §40: банковский счёт + его операции
  const [bank, setBank] = useState<{ account: BankAccount | null; ops: BankOp[] } | null>(null);
  const [showBankWithdraw, setShowBankWithdraw] = useState(false);
  const [showBankTopup, setShowBankTopup] = useState(false);
  const [accNumber, setAccNumber] = useState('');
  const [accHolder, setAccHolder] = useState('');
  const [accBank, setAccBank] = useState('');
  const [accBusy, setAccBusy] = useState(false);
  const [accError, setAccError] = useState<string | null>(null);

  // SPEC v6 §32: баланс — обычное число у всех, особой отметки для владельца нет
  const balanceDisplay = balance === null ? '…' : formatRub(balance);

  const applyBalance = useCallback(
    (next: number) => {
      setBalance(next);
      if (user) updateUser({ ...user, balance: next });
    },
    [user, updateUser],
  );

  const loadBank = useCallback(async () => {
    try {
      setBank(await api.getBank());
    } catch {
      setBank({ account: null, ops: [] });
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.wallet();
      setBalance(data.balance);
      setPayments(data.payments);
      if (user) updateUser({ ...user, balance: data.balance });
      void loadBank();
    } catch (e) {
      setPayments([]);
      toast(e instanceof Error ? e.message : 'Не удалось загрузить кошелёк', 'error');
    }
  }, [user, updateUser, toast, loadBank]);

  useEffect(() => {
    void load();
  }, [load]);

  /* живое обновление: зарплата/перевод пришли, пока открыт кошелёк */
  useEffect(() => {
    if (!socket) return;
    const onWallet = () => {
      void load();
    };
    socket.on('wallet:updated', onWallet);
    return () => {
      socket.off('wallet:updated', onWallet);
    };
  }, [socket, load]);

  /* ---- привязка/отвязка банковского счёта ---- */

  const linkAccount = async () => {
    if (!isValidAccountNumber(accNumber)) {
      setAccError('Номер карты:16 цифр или IBAN (20 символов)');
      return;
    }
    const holder = accHolder.trim();
    if (!holder) {
      setAccError('Укажите имя держателя');
      return;
    }
    const bankName = accBank.trim();
    if (!bankName) {
      setAccError('Укажите название банка');
      return;
    }
    setAccBusy(true);
    setAccError(null);
    try {
      await api.linkBankAccount(accNumber, holder, bankName);
      toast('Банковский счёт привязан', 'success');
      setAccNumber('');
      setAccHolder('');
      setAccBank('');
      await loadBank();
    } catch (e) {
      setAccError(e instanceof Error ? e.message : 'Не удалось привязать счёт');
    } finally {
      setAccBusy(false);
    }
  };

  const unlinkAccount = async () => {
    setAccBusy(true);
    try {
      await api.unlinkBankAccount();
      toast('Банковский счёт отвязан', 'success');
      await loadBank();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось отвязать счёт', 'error');
    } finally {
      setAccBusy(false);
    }
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button className="icon-btn only-mobile" onClick={onOpenNav} title="Меню">
            <MenuIcon />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="screen-title">Кошелёк</div>
            <div className="screen-sub">Баланс, переводы и история операций</div>
          </div>
        </div>
      </div>

      <div className="list-column">
        <div className="wallet-card">
          <div className="wallet-label">Ваш баланс</div>
          <div className="wallet-balance">{balanceDisplay}</div>
          <div className="wallet-actions">
            <button className="btn btn-primary" onClick={() => setShowTopup(true)}>
              <ArrowDownLeftIcon size={15} /> Пополнить
            </button>
            <button className="btn btn-ghost" onClick={() => setShowTransfer(true)}>
              <ArrowRightIcon size={15} /> Перевести
            </button>
          </div>
        </div>

        {/* SPEC v9 §40: банковский счёт — вывод на карту и пополнение с неё */}
        <p className="panel-section-title" style={{ marginTop: 20 }}>
          Банковский счёт
        </p>

        {bank === null ? (
          <div className="empty-state">Загрузка…</div>
        ) : bank.account === null ? (
          <div className="summary-box">
            <div className="hint" style={{ marginBottom: 4 }}>
              Привяжите карту, чтобы выводить деньги на свой банковский счёт и
              пополнять счёт в приложении с неё
            </div>
            {accError && <div className="form-error">{accError}</div>}
            <div className="field">
              <label>Номер карты</label>
              <input
                className="input card-input"
                autoComplete="cc-number"
                value={accNumber}
                placeholder="0000 0000 0000 0000"
                onChange={(e) => {
                  setAccNumber(maskBankInput(e.target.value));
                  setAccError(null);
                }}
              />
              <span className="hint">Номер не сохраняется — только маска и последние4 цифры</span>
            </div>
            <div className="field">
              <label>Имя держателя</label>
              <input
                className="input"
                value={accHolder}
                placeholder="Иванов Иван"
                maxLength={100}
                onChange={(e) => {
                  setAccHolder(e.target.value);
                  setAccError(null);
                }}
              />
            </div>
            <div className="field">
              <label>Банк</label>
              <input
                className="input"
                value={accBank}
                placeholder="Название банка"
                maxLength={100}
                onChange={(e) => {
                  setAccBank(e.target.value);
                  setAccError(null);
                }}
              />
            </div>
            <button className="btn btn-primary" disabled={accBusy} onClick={() => void linkAccount()}>
              {accBusy ? 'Привязка…' : 'Привязать счёт'}
            </button>
          </div>
        ) : (
          <div className="summary-box">
            <div className="info-kv">
              <span className="k">Карта</span>
              <span className="v">
                {bank.account.bank} · {bank.account.numberMasked}
              </span>
            </div>
            <div className="info-kv">
              <span className="k">Держатель</span>
              <span className="v">{bank.account.holder}</span>
            </div>
            <div className="wallet-actions" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={() => setShowBankWithdraw(true)}>
                <ArrowUpRightIcon size={15} /> Вывести на карту
              </button>
              <button className="btn btn-ghost" onClick={() => setShowBankTopup(true)}>
                <ArrowDownLeftIcon size={15} /> Пополнить с карты
              </button>
              <button className="btn btn-ghost" disabled={accBusy} onClick={() => void unlinkAccount()}>
                Отвязать
              </button>
            </div>
            {bank.ops.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="hint" style={{ marginBottom: 6 }}>
                  Банковские операции
                </div>
                {bank.ops.slice(0, 3).map((op) => (
                  <div className="info-kv" key={op.id}>
                    <span className="k">
                      {op.type === 'withdraw' ? 'Вывод' : 'Пополнение'} · •••• {op.accountLast4} ·{' '}
                      {timeFmt.format(op.createdAt)}
                    </span>
                    <span className="v">
                      {op.type === 'withdraw' ? '−' : '+'}
                      {formatRub(op.amount)} · Исполнено
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="panel-section-title" style={{ marginTop: 20 }}>
          История операций
        </p>

        {payments === null ? (
          <div className="empty-state">Загрузка…</div>
        ) : payments.length === 0 ? (
          <div className="empty-state">
            <WalletIcon size={26} />
            <div style={{ marginTop: 8 }}>Операций пока нет — пополните счёт</div>
          </div>
        ) : (
          payments.map((p) => <PayRow key={p.id} payment={p} />)
        )}
      </div>

      {showTopup && (
        <TopupModal
          onClose={() => setShowTopup(false)}
          onDone={(b) => applyBalance(b)}
        />
      )}
      {showTransfer && (
        <TransferModal
          onClose={() => setShowTransfer(false)}
          onDone={(b) => applyBalance(b)}
        />
      )}
      {showBankWithdraw && bank?.account && (
        <BankWithdrawModal
          account={bank.account}
          onClose={() => setShowBankWithdraw(false)}
          onDone={(b) => {
            applyBalance(b);
            void loadBank();
          }}
        />
      )}
      {showBankTopup && bank?.account && (
        <BankTopupModal
          account={bank.account}
          onClose={() => setShowBankTopup(false)}
          onDone={(b) => {
            applyBalance(b);
            void loadBank();
          }}
        />
      )}
    </div>
  );
}
