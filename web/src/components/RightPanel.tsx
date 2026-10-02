import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api';
import { useApp, type PanelTab } from '../store';
import {
  canCancelInvite,
  canCreateChannel,
  canDismiss,
  canEditOrg,
  canInvite,
  canLeaveOrg,
  canViewOrgInvites,
  canViewStaffDocs,
  assignableRoles,
} from '../permissions';
import {
  ALL_ROLES,
  balanceText,
  formatRub,
  isRecord,
  paymentKindLabel,
  roleLabel,
  roleRank,
  unwrapUser,
  type ActivityEntry,
  type OrgDismissal,
  type OrgFinance,
  type OrgFinanceTx,
  type OrgMember,
  type PendingInvite,
  type Role,
  type User,
} from '../types';
import { Avatar } from './Avatar';
import { ConfirmModal, Modal } from './Modal';
import { OwnerBadge } from './OwnerBadge';
import { Toggle } from './Toggle';
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  DoorOpenIcon,
  HistoryIcon,
  InfoIcon,
  MailIcon,
  MessageIcon,
  MoreIcon,
  PencilIcon,
  ShieldIcon,
  UserPlusIcon,
  UsersIcon,
  WalletIcon,
  XIcon,
} from './icons';

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/* ============================================================
   Edit org (rank ≥ 60)
   ============================================================ */

function EditOrgModal({ onClose }: { onClose: () => void }) {
  const { detail, refreshDetail, refreshOrgs, toast } = useApp();
  const [name, setName] = useState(detail?.org.name ?? '');
  const [description, setDescription] = useState(detail?.org.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!detail) return null;

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Введите название организации (минимум 2 символа)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patchOrg(detail.org.id, {
        name: trimmed,
        description: description.trim(),
      });
      await Promise.all([refreshDetail(), refreshOrgs()]);
      toast('Организация обновлена', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Редактировать организацию"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Название</label>
        <input
          className="input"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Описание</label>
        <textarea
          className="textarea"
          value={description}
          maxLength={400}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Расскажите об организации"
        />
      </div>
    </Modal>
  );
}

/* ============================================================
   Invite a participant (rank ≥ 40)
   ============================================================ */

function InviteUserModal({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: () => void;
}) {
  const { currentOrgId, detail, toast } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [picked, setPicked] = useState<User | null>(null);
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rank = detail ? roleRank(detail.role) : 0;
  const inviteableRoles = ALL_ROLES.filter((r) => roleRank(r) < rank);

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
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, picked]);

  const submit = async () => {
    if (!picked || !currentOrgId) return;
    setBusy(true);
    setError(null);
    try {
      await api.invite(currentOrgId, picked.username, role);
      toast(`Приглашение отправлено пользователю @${picked.username}`, 'success');
      onInvited();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить приглашение');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Пригласить участника"
      subtitle="Пользователь подпишет договор о присоединении"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn-primary"
            disabled={!picked || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Отправка…' : 'Отправить приглашение'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Пользователь (имя или почта)</label>
        <input
          className="input"
          value={picked ? `@${picked.username}` : q}
          disabled={picked !== null}
          onChange={(e) => {
            setQ(e.target.value);
            setPicked(null);
          }}
          placeholder="Начните вводить имя…"
          autoFocus
        />
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
          <div className="owner-hint">Этот пользователь вступит как Владелец</div>
        )}
        {!picked && q.trim().length > 0 && results.length === 0 && (
          <div className="hint">Ничего не найдено</div>
        )}
      </div>
      <div className="field">
        <label>Роль в организации</label>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {inviteableRoles.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

/* ============================================================
   Dismissal contract creation (SPEC v2 §14.6)
   ============================================================ */

function DismissModal({
  member,
  onClose,
  onDone,
}: {
  member: OrgMember;
  onClose: () => void;
  onDone: () => void;
}) {
  const { currentOrgId, toast } = useApp();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!currentOrgId) return;
    setBusy(true);
    setError(null);
    try {
      await api.createDismissal(currentOrgId, {
        userId: member.user.id,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast(`Договор об увольнении отправлен: ${member.user.displayName}`, 'success');
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить договор');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Уволить сотрудника?"
      subtitle={`${member.user.displayName} · ${roleLabel(member.role)}`}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-danger-filled" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Отправка…' : 'Отправить договор'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <p className="dismiss-note">
        Сотруднику будет отправлен договор об увольнении, который он должен подписать от руки.
        Членство не удаляется, пока договор не подписан.
      </p>
      <div className="field">
        <label>Причина (необязательно)</label>
        <textarea
          className="textarea"
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Например, по инициативе организации"
        />
      </div>
    </Modal>
  );
}

/* ============================================================
   «Роли и права» matrix (SPEC §19)
   ============================================================ */

const MATRIX_COLUMNS: Role[] = ['owner', 'assistant_owner', 'admin', 'assistant_admin', 'member'];

type MatrixCell = boolean | string;

const MATRIX_ROWS: Array<{ label: string; cells: MatrixCell[] }> = [
  { label: 'Приглашать', cells: [true, true, true, true, false] },
  { label: 'Принимать/отклонять заявления', cells: [true, true, true, true, false] },
  { label: 'Создавать каналы', cells: [true, true, true, true, false] },
  { label: 'Удалять сообщения (любые, не свои)', cells: [true, true, true, true, false] },
  { label: 'Увольнять (договор, ниже по рангу)', cells: [true, true, true, false, false] },
  { label: 'Односторонний разрыв (terminate)', cells: [true, true, true, false, false] },
  { label: 'Менять роли', cells: [true, true, '✓*', false, false] },
  { label: 'Редактировать организацию, публичность', cells: [true, true, true, false, false] },
  { label: 'Просмотр заявок/увольнений орг.', cells: [true, true, true, true, false] },
  { label: 'Просмотр истории действий', cells: [true, true, true, true, true] },
  { label: 'Чаты, звонки, каталог, подача заявлений', cells: [true, true, true, true, true] },
];

function RolesMatrix({ myRole }: { myRole: Role }) {
  const myCol = MATRIX_COLUMNS.indexOf(myRole);
  return (
    <div className="roles-wrap">
      <table className="roles-table">
        <thead>
          <tr>
            <th className="act">Действие</th>
            {MATRIX_COLUMNS.map((r, i) => (
              <th key={r} className={i === myCol ? 'col-hl' : ''}>
                {roleLabel(r)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MATRIX_ROWS.map((row) => (
            <tr key={row.label}>
              <td className="act">{row.label}</td>
              {row.cells.map((cell, i) => (
                <td key={i} className={i === myCol ? 'col-hl' : ''}>
                  {typeof cell === 'string' ? cell : cell ? '✓' : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hint" style={{ marginTop: 8 }}>
        ✓* — роли можно менять только ниже собственной; владелец не может изменить роль
        владельца. Ваша роль выделена цветом.
      </div>
    </div>
  );
}

/* ============================================================
   Финансы организации (SPEC v4 §24)
   ============================================================ */

const moneyChips = [500, 1000, 5000];

function TreasuryDepositModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { currentOrgId, toast, user, updateUser } = useApp();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount.replace(/\D/g, '') || 0);

  const submit = async () => {
    if (!currentOrgId) return;
    if (value < 1 || value > 100000000) {
      setError('Сумма: положительное целое число');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.treasuryDeposit(currentOrgId, value);
      if (user) updateUser({ ...user, balance: res.userBalance });
      toast(`В казначейство переведено: ${formatRub(value)}`, 'success');
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError('Недостаточно средств');
      else setError(e instanceof Error ? e.message : 'Не удалось пополнить казначейство');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Пополнить казначейство"
      subtitle="Средства спишутся с вашего личного баланса"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Перевод…' : 'Пополнить'}
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
          placeholder="5000"
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 9))}
          autoFocus
        />
        <div className="chips">
          {moneyChips.map((c) => (
            <button
              key={c}
              className={value === c ? 'chip active' : 'chip'}
              onClick={() => setAmount(String(c))}
            >
              {formatRub(c)}
            </button>
          ))}
        </div>
        <span className="hint">
          Доступно на личном балансе: {balanceText(user?.balance ?? null, user?.isOwner)}
        </span>
      </div>
    </Modal>
  );
}

function PayrollModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { currentOrgId, detail, toast } = useApp();
  const members = detail?.members ?? [];
  const [userId, setUserId] = useState(members[0]?.user.id ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = Number(amount.replace(/\D/g, '') || 0);
  const target = members.find((m) => m.user.id === userId) ?? null;

  const submit = async () => {
    if (!currentOrgId) return;
    if (!target) {
      setError('Выберите сотрудника');
      return;
    }
    if (value < 1 || value > 100000000) {
      setError('Сумма: положительное целое число');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.payroll(currentOrgId, {
        userId: target.user.id,
        amount: value,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast(`Зарплата выплачена: ${formatRub(value)} → ${target.user.displayName}`, 'success');
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError('Недостаточно средств в казначестве');
      else setError(e instanceof Error ? e.message : 'Не удалось выплатить зарплату');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Выплатить зарплату"
      subtitle="Средства уходят из казначества организации"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Выплата…' : 'Выплатить'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Сотрудник</label>
        <select className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
          {members.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.displayName} (@{m.user.username}) — {roleLabel(m.role)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Сумма, ₽</label>
        <input
          className="input"
          inputMode="numeric"
          value={amount}
          placeholder="50000"
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 9))}
        />
        <div className="chips">
          {moneyChips.map((c) => (
            <button
              key={c}
              className={value === c ? 'chip active' : 'chip'}
              onClick={() => setAmount(String(c))}
            >
              {formatRub(c)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Комментарий (необязательно)</label>
        <input
          className="input"
          value={note}
          maxLength={300}
          placeholder="Оклад за месяц, премия…"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {target && value > 0 && (
        <div className="summary-box">
          <div className="info-kv">
            <span className="k">Получатель</span>
            <span className="v">{target.user.displayName}</span>
          </div>
          <div className="info-kv">
            <span className="k">Сумма</span>
            <span className="v">{formatRub(value)}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

function financeTxRow(tx: OrgFinanceTx, selfId: string | null, canManage: boolean) {
  const isIn = canManage ? tx.kind === 'treasury_deposit' : tx.toUser?.id === selfId;
  const kindLabel = paymentKindLabel(tx.kind);
  const title = canManage
    ? tx.kind === 'treasury_deposit'
      ? `Пополнение · ${tx.fromUser?.displayName ?? '—'}`
      : tx.toUser
        ? `${tx.toUser.displayName} · ${kindLabel}`
        : kindLabel
    : kindLabel;
  return (
    <div className="pay-row" key={tx.id}>
      <span className={isIn ? 'pay-icon in' : 'pay-icon out'} aria-hidden>
        {isIn ? <ArrowDownLeftIcon size={16} /> : <ArrowUpRightIcon size={16} />}
      </span>
      <div className="pay-main">
        <div className="pay-title">{title}</div>
        <div className="pay-sub">
          {timeFmt.format(tx.createdAt)}
          {tx.note ? ` · ${tx.note}` : ''}
        </div>
      </div>
      <div className="pay-right">
        <span className={isIn ? 'pay-amount in' : 'pay-amount out'}>
          {isIn ? '+' : '−'}
          {formatRub(tx.amount)}
        </span>
      </div>
    </div>
  );
}

function FinanceTab({ rank }: { rank: number }) {
  const { currentOrgId, user } = useApp();
  const [finance, setFinance] = useState<OrgFinance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);
  const [showPayroll, setShowPayroll] = useState(false);

  const load = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      setFinance(await api.orgFinance(currentOrgId));
      setError(null);
    } catch (e) {
      setFinance(null);
      setError(e instanceof Error ? e.message : 'Не удалось загрузить финансы');
    }
  }, [currentOrgId]);

  useEffect(() => {
    setFinance(null);
    void load();
  }, [load]);

  if (error) return <div className="form-error">{error}</div>;
  if (!finance) return <div className="empty-state">Загрузка…</div>;

  const canManage = finance.canManage && rank >= 60;
  const selfId = user?.id ?? null;

  if (!canManage) {
    const own = finance.transactions;
    const total = own.reduce((sum, t) => sum + t.amount, 0);
    return (
      <>
        <p className="panel-section-title">Мои начисления</p>
        <div className="info-card">
          <div className="wallet-label">Начислено этой организацией</div>
          <div className="wallet-balance small">{formatRub(total)}</div>
        </div>
        {own.length === 0 ? (
          <div className="empty-state">Пока нет начислений</div>
        ) : (
          own.map((tx) => financeTxRow(tx, selfId, false))
        )}
      </>
    );
  }

  return (
    <>
      <p className="panel-section-title">Казначейство организации</p>
      <div className="info-card">
        <div className="wallet-label">Баланс казначейства</div>
        <div className="wallet-balance small">{formatRub(finance.balance)}</div>
        <div className="wallet-actions" style={{ marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowDeposit(true)}>
            Пополнить казначейство
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowPayroll(true)}>
            Выплатить зарплату
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Выплачено всего: {formatRub(finance.payrollTotals.reduce((s, t) => s + t.total, 0))}
        </div>
      </div>

      <p className="panel-section-title" style={{ marginTop: 16 }}>
        История операций
      </p>
      {finance.transactions.length === 0 ? (
        <div className="empty-state">Операций пока нет</div>
      ) : (
        finance.transactions.map((tx) => financeTxRow(tx, selfId, true))
      )}

      <p className="panel-section-title" style={{ marginTop: 16 }}>
        Выплачено
      </p>
      {finance.payrollTotals.length === 0 ? (
        <div className="empty-state">Выплат пока не было</div>
      ) : (
        finance.payrollTotals.map((t) => (
          <div className="member-row" key={t.user.id}>
            <Avatar name={t.user.displayName} color={t.user.avatarColor} size={28} />
            <div className="who">
              <div className="nm">{t.user.displayName}</div>
              <div className="un">@{t.user.username}</div>
            </div>
            {t.user.isOwner && <OwnerBadge />}
            <span className="pay-amount in">{formatRub(t.total)}</span>
          </div>
        ))
      )}

      {showDeposit && (
        <TreasuryDepositModal onClose={() => setShowDeposit(false)} onDone={() => void load()} />
      )}
      {showPayroll && (
        <PayrollModal onClose={() => setShowPayroll(false)} onDone={() => void load()} />
      )}
    </>
  );
}

/* ============================================================
   Right panel
   ============================================================ */

function toActivity(raw: unknown): ActivityEntry | null {
  if (!isRecord(raw)) return null;
  const a = isRecord(raw.activity) ? raw.activity : raw;
  if (typeof a.id !== 'string') return null;
  return {
    id: a.id,
    orgId: typeof a.orgId === 'string' ? a.orgId : undefined,
    action: typeof a.action === 'string' ? a.action : '',
    details: typeof a.details === 'string' ? a.details : '',
    actor: unwrapUser(a.actor),
    targetUser: unwrapUser(a.targetUser ?? a.target_user),
    createdAt: typeof a.createdAt === 'number' ? a.createdAt : Date.now(),
  };
}

export function RightPanel() {
  const {
    user,
    socket,
    detail,
    currentOrgId,
    panelTab,
    setPanelTab,
    closePanel,
    online,
    startDM,
    refreshDetail,
    refreshOrgs,
    refreshInvites,
    setView,
    toast,
  } = useApp();

  const [roleMenu, setRoleMenu] = useState<string | null>(null);
  const [showEditOrg, setShowEditOrg] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<OrgMember | null>(null);
  const [terminateTarget, setTerminateTarget] = useState<OrgDismissal | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PendingInvite | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [pending, setPending] = useState<PendingInvite[] | null>(null);
  const [dismissals, setDismissals] = useState<OrgDismissal[] | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const actor = { id: user?.id ?? '', role: detail?.role ?? ('member' as Role) };
  const rank = roleRank(actor.role);

  useEffect(() => {
    if (!roleMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setRoleMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [roleMenu]);

  // Load outgoing pending invites when the tab is opened.
  const loadPending = async () => {
    if (!currentOrgId) return;
    try {
      const list = await api.listOrgInvites(currentOrgId);
      setPending(list);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось загрузить приглашения', 'error');
      setPending([]);
    }
  };

  useEffect(() => {
    if (panelTab !== 'invites') return;
    if (!canViewOrgInvites(rank)) return;
    setPending(null);
    void loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelTab, currentOrgId, rank]);

  /* ---- dismissal documents of this org (staff) ---- */

  const loadDismissals = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const list = await api.orgDismissals(currentOrgId);
      setDismissals(list);
    } catch {
      setDismissals([]);
    }
  }, [currentOrgId]);

  useEffect(() => {
    if (panelTab !== 'members' || !canViewStaffDocs(rank)) return;
    setDismissals(null);
    void loadDismissals();
  }, [panelTab, rank, detail, loadDismissals]);

  /* ---- activity log (SPEC v3 §18) ---- */

  const loadActivity = useCallback(
    async (before?: string) => {
      if (!currentOrgId) return;
      setActivityBusy(true);
      try {
        const res = await api.activity(currentOrgId, before);
        setActivity((prev) => {
          if (!before) return res.activity;
          const seen = new Set((prev ?? []).map((a) => a.id));
          return [...(prev ?? []), ...res.activity.filter((a) => !seen.has(a.id))];
        });
        setActivityHasMore(res.hasMore);
      } catch (e) {
        if (!before) {
          setActivity([]);
          setActivityHasMore(false);
        }
        toast(e instanceof Error ? e.message : 'Не удалось загрузить историю', 'error');
      } finally {
        setActivityBusy(false);
      }
    },
    [currentOrgId, toast],
  );

  useEffect(() => {
    if (panelTab !== 'activity') return;
    setActivity(null);
    setActivityHasMore(false);
    void loadActivity();
  }, [panelTab, currentOrgId, loadActivity]);

  useEffect(() => {
    if (!socket || panelTab !== 'activity') return;
    const onActivityNew = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const entry = toActivity(payload.activity ?? payload);
      if (!entry) return;
      const orgId = entry.orgId ?? (typeof payload.orgId === 'string' ? payload.orgId : null);
      if (orgId && orgId !== currentOrgId) return;
      setActivity((prev) => {
        if (!prev) return prev;
        if (prev.some((a) => a.id === entry.id)) return prev;
        return [entry, ...prev];
      });
    };
    socket.on('activity:new', onActivityNew);
    return () => {
      socket.off('activity:new', onActivityNew);
    };
  }, [socket, panelTab, currentOrgId]);

  if (!detail) return null;

  const tabs: Array<{ id: PanelTab; label: string; icon: ReactNode }> = [
    { id: 'members', label: 'Участники', icon: <UsersIcon size={13} /> },
    ...(canViewOrgInvites(rank)
      ? [{ id: 'invites' as PanelTab, label: 'Приглашения', icon: <MailIcon size={13} /> }]
      : []),
    { id: 'activity', label: 'История', icon: <HistoryIcon size={13} /> },
    { id: 'finance', label: 'Финансы', icon: <WalletIcon size={13} /> },
    { id: 'roles', label: 'Роли и права', icon: <ShieldIcon size={13} /> },
    { id: 'info', label: 'Информация', icon: <InfoIcon size={13} /> },
  ];

  const changeRole = async (member: OrgMember, role: Role) => {
    setRoleMenu(null);
    if (!currentOrgId) return;
    try {
      await api.setMemberRole(currentOrgId, member.user.id, role);
      toast(`Роль изменена: ${member.user.displayName} → ${roleLabel(role)}`, 'success');
      await refreshDetail();
      void refreshOrgs();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось изменить роль', 'error');
    }
  };

  const afterDismissalChange = async () => {
    await Promise.all([refreshDetail(), refreshOrgs()]);
    void loadDismissals();
  };

  const cancelDismissal = async (doc: OrgDismissal) => {
    try {
      await api.cancelDocument(doc.document.id);
      toast('Увольнение отменено', 'success');
      await afterDismissalChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось отменить увольнение', 'error');
    }
  };

  const terminateDismissal = async () => {
    const target = terminateTarget;
    setTerminateTarget(null);
    if (!target) return;
    try {
      await api.terminateDocument(target.document.id);
      toast(
        target.targetUser
          ? `${target.targetUser.displayName} исключён(а) по одностороннему расторжению`
          : 'Договор расторгнут в одностороннем порядке',
        'success',
      );
      await afterDismissalChange();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось расторгнуть договор', 'error');
    }
  };

  const setPublicity = async (isPublic: boolean) => {
    try {
      await api.patchOrg(detail.org.id, { isPublic });
      await Promise.all([refreshDetail(), refreshOrgs()]);
      toast(
        isPublic
          ? 'Организация видна в каталоге'
          : 'Организация скрыта из каталога',
        'success',
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось изменить публичность', 'error');
    }
  };

  const cancelInvite = async () => {
    if (!cancelTarget) return;
    try {
      await api.cancelInvite(cancelTarget.id);
      toast('Приглашение отменено', 'success');
      setCancelTarget(null);
      await loadPending();
    } catch (e) {
      setCancelTarget(null);
      toast(e instanceof Error ? e.message : 'Не удалось отменить приглашение', 'error');
    }
  };

  const leaveOrg = async () => {
    if (!currentOrgId) return;
    try {
      await api.leaveOrg(currentOrgId);
      const orgName = detail.org.name;
      setLeaveConfirm(false);
      closePanel();
      setView('chat');
      await refreshOrgs();
      await refreshInvites();
      toast(`Вы покинули организацию «${orgName}»`, 'success');
      // the org-selection effect re-picks the next org (or shows an empty state)
    } catch (e) {
      setLeaveConfirm(false);
      toast(e instanceof Error ? e.message : 'Не удалось покинуть организацию', 'error');
    }
  };

  /* ---------------- tabs: members ---------------- */

  const renderMembers = () => (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p className="panel-section-title" style={{ margin: 0 }}>
          Участники — {detail.members.length}
        </p>
        {canInvite(rank) && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowInvite(true)}>
            <UserPlusIcon size={13} /> Пригласить
          </button>
        )}
      </div>
      {detail.members.length === 0 && <div className="empty-state">Нет участников</div>}
      {detail.members.map((m) => {
        const isSelf = m.user.id === actor.id;
        const assignable = assignableRoles(actor, m.role);
        const dismissable = !isSelf && canDismiss(actor, { id: m.user.id, role: m.role });
        const pendingDoc =
          m.dismissalPending && canViewStaffDocs(rank)
            ? dismissals?.find(
                (d) =>
                  (d.targetUser?.id === m.user.id ||
                    d.document.targetUserId === m.user.id) &&
                  d.document.status === 'pending',
              ) ?? null
            : null;
        const menuOpen = roleMenu === m.user.id;
        return (
          <div className="member-row-wrap" key={m.user.id}>
            <div className="member-row">
              <Avatar
                name={m.user.displayName}
                color={m.user.avatarColor}
                size={32}
                showDot
                online={online.has(m.user.id)}
              />
              <div className="who">
                <div className="nm">
                  {m.user.displayName}
                  {isSelf && <span className="muted"> (вы)</span>}
                </div>
                <div className="un">@{m.user.username}</div>
              </div>
              {m.user.isOwner && <OwnerBadge />}
              <span className={`role-badge ${m.role}`}>{roleLabel(m.role)}</span>
              {m.dismissalPending && canViewStaffDocs(rank) && (
                <span className="status-badge pending dismiss-badge">Ожидает подписи</span>
              )}
              <div className="member-actions">
                {!isSelf && (
                  <button
                    className="icon-btn"
                    title="Написать сообщение"
                    onClick={() => {
                      void startDM(m.user.id);
                      closePanel();
                    }}
                  >
                    <MessageIcon size={15} />
                  </button>
                )}
                {(assignable.length > 0 || dismissable) && (
                  <button
                    className="icon-btn"
                    title="Действия"
                    onClick={() => setRoleMenu(menuOpen ? null : m.user.id)}
                  >
                    <MoreIcon size={15} />
                  </button>
                )}
              </div>
              {menuOpen && (
                <div className="dropdown" style={{ top: 'auto', bottom: 8, left: 'auto', right: 8, width: 240 }} ref={menuRef}>
                  {assignable.map((r) => (
                    <button
                      key={r}
                      className="dropdown-item"
                      onClick={() => void changeRole(m, r)}
                    >
                      <span className="grow">{roleLabel(r)}</span>
                      {r === m.role && <span className="muted">текущая</span>}
                    </button>
                  ))}
                  {dismissable && (
                    <>
                      {assignable.length > 0 && <div className="dropdown-sep" />}
                      <button
                        className="dropdown-item danger"
                        onClick={() => {
                          setRoleMenu(null);
                          setDismissTarget(m);
                        }}
                      >
                        <span className="grow">Уволить</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {pendingDoc && dismissable && (
              <div className="member-dismiss">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void cancelDismissal(pendingDoc)}
                >
                  Отменить увольнение
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setTerminateTarget(pendingDoc)}
                >
                  Расторгнуть в одностороннем порядке
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  /* ---------------- tabs: pending invites ---------------- */

  const renderInvites = () => {
    if (!canViewOrgInvites(rank)) {
      return <div className="empty-state">Нет доступа к приглашениям</div>;
    }
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p className="panel-section-title" style={{ margin: 0 }}>
            Исходящие приглашения
          </p>
          {canInvite(rank) && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowInvite(true)}>
              <UserPlusIcon size={13} /> Пригласить
            </button>
          )}
        </div>
        {pending === null && <div className="empty-state">Загрузка…</div>}
        {pending !== null && pending.length === 0 && (
          <div className="empty-state">Нет приглашений</div>
        )}
        {pending?.map((inv) => {
          const inviterId = inv.inviter?.id ?? null;
          const cancellable = canCancelInvite(actor, inviterId);
          return (
            <div className="invite-card" key={inv.id}>
              <div className="row">
                <Avatar
                  name={inv.invitee?.displayName ?? '??'}
                  color={inv.invitee?.avatarColor ?? '#6C5CE7'}
                  size={30}
                />
                <div className="grow">
                  <div className="org" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{inv.invitee?.displayName ?? 'Пользователь'}</span>
                    {inv.invitee?.isOwner && <OwnerBadge />}
                  </div>
                  <div className="meta">
                    @{inv.invitee?.username ?? '—'} · {roleLabel(inv.role)} ·{' '}
                    {dateFmt.format(inv.createdAt)}
                  </div>
                </div>
              </div>
              {cancellable && (
                <div className="actions">
                  <button className="btn btn-danger btn-sm" onClick={() => setCancelTarget(inv)}>
                    Отменить приглашение
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  /* ---------------- tabs: activity ---------------- */

  const renderActivity = () => (
    <>
      <p className="panel-section-title">История действий</p>
      {activity === null ? (
        <div className="empty-state">Загрузка…</div>
      ) : activity.length === 0 ? (
        <div className="empty-state">История пока пуста</div>
      ) : (
        <>
          {activity.map((a) => (
            <div className="activity-item" key={a.id}>
              {a.actor ? (
                <Avatar name={a.actor.displayName} color={a.actor.avatarColor} size={24} />
              ) : (
                <span className="activity-dot" aria-hidden />
              )}
              <div className="activity-body">
                <div className="activity-text">{a.details}</div>
                <div className="activity-time">{timeFmt.format(a.createdAt)}</div>
              </div>
            </div>
          ))}
          {activityHasMore && (
            <button
              className="btn btn-ghost btn-block btn-sm"
              style={{ marginTop: 10 }}
              disabled={activityBusy}
              onClick={() => void loadActivity(activity[activity.length - 1]?.id)}
            >
              {activityBusy ? 'Загрузка…' : 'Показать ещё'}
            </button>
          )}
        </>
      )}
    </>
  );

  /* ---------------- tabs: roles ---------------- */

  const renderRoles = () => (
    <>
      <p className="panel-section-title">Роли и права</p>
      <RolesMatrix myRole={actor.role} />
    </>
  );

  /* ---------------- tabs: info ---------------- */

  const renderInfo = () => (
    <>
      <p className="panel-section-title">Об организации</p>
      <div className="info-card">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{detail.org.name}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>
          {detail.org.description?.trim() ? detail.org.description : 'Описание не добавлено'}
        </div>
        {canEditOrg(rank) && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 12 }}
            onClick={() => setShowEditOrg(true)}
          >
            <PencilIcon size={13} /> Редактировать
          </button>
        )}
      </div>

      {canEditOrg(rank) && (
        <div className="info-card">
          <Toggle
            checked={detail.org.isPublic !== false}
            onChange={(v) => void setPublicity(v)}
            label="Публичная организация (видна в каталоге)"
          />
        </div>
      )}

      <div className="info-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <div className="info-kv">
          <span className="k">Участников</span>
          <span className="v">{detail.members.length}</span>
        </div>
        <div className="info-kv">
          <span className="k">Каналов</span>
          <span className="v">{detail.channels.length}</span>
        </div>
        <div className="info-kv">
          <span className="k">Создана</span>
          <span className="v">{dateFmt.format(detail.org.createdAt)}</span>
        </div>
        <div className="info-kv">
          <span className="k">Ваша роль</span>
          <span className="v" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className={`role-badge ${actor.role}`}>{roleLabel(actor.role)}</span>
            {user?.isOwner && <OwnerBadge />}
          </span>
        </div>
      </div>

      {canCreateChannel(rank) && (
        <div className="hint" style={{ marginTop: 4 }}>
          Вы можете создавать каналы и приглашать участников.
        </div>
      )}
    </>
  );

  return (
    <aside className="right-panel">
      <div className="panel-head">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={panelTab === t.id ? 'panel-tab active' : 'panel-tab'}
            onClick={() => setPanelTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <button className="icon-btn panel-close" title="Закрыть панель" onClick={closePanel}>
          <XIcon size={16} />
        </button>
      </div>

      <div className="panel-body">
        {panelTab === 'members' && renderMembers()}
        {panelTab === 'invites' && renderInvites()}
        {panelTab === 'activity' && renderActivity()}
        {panelTab === 'finance' && <FinanceTab rank={rank} />}
        {panelTab === 'roles' && renderRoles()}
        {panelTab === 'info' && renderInfo()}
      </div>

      {canLeaveOrg(actor) && (
        <div className="panel-footer">
          <button className="btn btn-danger btn-block" onClick={() => setLeaveConfirm(true)}>
            <DoorOpenIcon size={15} /> Покинуть организацию
          </button>
        </div>
      )}

      {showEditOrg && <EditOrgModal onClose={() => setShowEditOrg(false)} />}
      {showInvite && (
        <InviteUserModal
          onClose={() => setShowInvite(false)}
          onInvited={() => void loadPending()}
        />
      )}
      {dismissTarget && (
        <DismissModal
          member={dismissTarget}
          onClose={() => setDismissTarget(null)}
          onDone={() => void afterDismissalChange()}
        />
      )}
      {terminateTarget && (
        <ConfirmModal
          title="Расторгнуть в одностороннем порядке?"
          text={`Договор об увольнении будет расторгнут без подписи сотрудника, ${terminateTarget.targetUser?.displayName ?? 'участник'} потеряет доступ к организации и всем её чатам.`}
          confirmLabel="Расторгнуть"
          onConfirm={terminateDismissal}
          onClose={() => setTerminateTarget(null)}
        />
      )}
      {cancelTarget && (
        <ConfirmModal
          title="Отменить приглашение?"
          text={`Приглашение для @${cancelTarget.invitee?.username ?? 'пользователя'} будет отменено.`}
          confirmLabel="Отменить приглашение"
          onConfirm={cancelInvite}
          onClose={() => setCancelTarget(null)}
        />
      )}
      {leaveConfirm && (
        <ConfirmModal
          title="Покинуть организацию?"
          text={`Вы больше не сможете читать чаты организации «${detail.org.name}». Договор можно будет подписать заново только по новому приглашению.`}
          confirmLabel="Покинуть"
          onConfirm={leaveOrg}
          onClose={() => setLeaveConfirm(false)}
        />
      )}
    </aside>
  );
}
