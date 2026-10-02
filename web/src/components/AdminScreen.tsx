/**
 * «Панель создателя» — раздел только для superadmin (SPEC v4 §23).
 * Виден исключительно при `user.isAdmin === true`; для остальных UI-следов нет.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, normalizeAuditItem, ApiError } from '../api';
import { useApp } from '../store';
import {
  balanceText,
  formatRub,
  isRecord,
  type AdminStats,
  type AdminUserRow,
  type AuditItem,
  type BotSettings,
  type LoginItem,
} from '../types';
import { Avatar } from './Avatar';
import { Modal } from './Modal';
import { OwnerBadge } from './OwnerBadge';
import { Toggle } from './Toggle';
import {
  BanIcon,
  BotIcon,
  DashboardIcon,
  HistoryIcon,
  LogInIcon,
  MenuIcon,
  RefreshIcon,
  SearchIcon,
  ShieldIcon,
  UsersIcon,
} from './icons';

interface ScreenProps {
  onOpenNav: () => void;
}

type AdminTab = 'overview' | 'audit' | 'logins' | 'users' | 'bot';

const TABS: Array<{ id: AdminTab; label: string; icon: ReactNode }> = [
  { id: 'overview', label: 'Обзор', icon: <DashboardIcon size={14} /> },
  { id: 'audit', label: 'Журнал', icon: <HistoryIcon size={14} /> },
  { id: 'logins', label: 'Входы', icon: <LogInIcon size={14} /> },
  { id: 'users', label: 'Пользователи', icon: <UsersIcon size={14} /> },
  { id: 'bot', label: 'Бот', icon: <BotIcon size={14} /> },
];

const dtFmt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/* ---------------- русские подписи действий журнала ---------------- */

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Вход',
  'auth.logout': 'Выход',
  'auth.register': 'Регистрация',
  'org.create': 'Создание организации',
  'org.updated': 'Изменение организации',
  'org.payroll': 'Выплата зарплаты',
  'org.treasury_deposit': 'Пополнение казначейства',
  'member.joined': 'Вступление',
  'member.left': 'Выход из организации',
  'role.changed': 'Смена роли',
  'invite.created': 'Приглашение',
  'invite.accepted': 'Приглашение принято',
  'invite.declined': 'Приглашение отклонено',
  'invite.canceled': 'Приглашение отменено',
  'application.submitted': 'Заявление',
  'application.approved': 'Заявление принято',
  'application.rejected': 'Заявление отклонено',
  'application.canceled': 'Заявление отозвано',
  'dismissal.created': 'Увольнение',
  'dismissal.signed': 'Договор об увольнении подписан',
  'dismissal.rejected': 'Увольнение оспорено',
  'dismissal.canceled': 'Увольнение отменено',
  'dismissal.terminated': 'Увольнение расторгнуто',
  'channel.created': 'Создание канала',
  'message.deleted': 'Удаление сообщения',
  'wallet.topup': 'Пополнение кошелька',
  'wallet.transfer': 'Перевод',
  'user.ban': 'Блокировка',
  'user.unban': 'Разблокировка',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/* ============================================================
   Обзор — статистика
   ============================================================ */

interface StatCard {
  key: keyof AdminStats;
  label: string;
  money?: boolean;
}

const PRIMARY_STATS: StatCard[] = [
  { key: 'users', label: 'Пользователей' },
  { key: 'onlineNow', label: 'Онлайн сейчас' },
  { key: 'orgs', label: 'Организаций' },
  { key: 'messages24h', label: 'Сообщений за 24 ч' },
  { key: 'totalBalance', label: 'Балансы кошельков', money: true },
  { key: 'paidTotal', label: 'Выплачено зарплат', money: true },
];

const SECONDARY_STATS: StatCard[] = [
  { key: 'usersToday', label: 'Новых за сегодня' },
  { key: 'usersActive24h', label: 'Активных за 24 ч' },
  { key: 'orgsPublic', label: 'Публичных организаций' },
  { key: 'members', label: 'Членств' },
  { key: 'messages', label: 'Всего сообщений' },
  { key: 'invitesPending', label: 'Ожидают приглашений' },
  { key: 'callsToday', label: 'Звонков сегодня' },
];

function StatGrid({ cards, stats }: { cards: StatCard[]; stats: AdminStats }) {
  return (
    <div className="stats-grid">
      {cards.map((c) => (
        <div className="stat-card" key={c.key}>
          <div className={c.money ? 'stat-value money' : 'stat-value'}>
            {c.money ? formatRub(stats[c.key]) : stats[c.key]}
          </div>
          <div className="stat-label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function OverviewTab() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setStats(await api.adminStats());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить статистику');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <p className="panel-section-title" style={{ margin: 0 }}>
          Обзор платформы
        </p>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void load()}>
          <RefreshIcon size={13} /> Обновить
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}
      {stats === null && !error && <div className="empty-state">Загрузка…</div>}

      {stats && (
        <>
          <div style={{ marginTop: 12 }}>
            <StatGrid cards={PRIMARY_STATS} stats={stats} />
          </div>
          <p className="panel-section-title" style={{ marginTop: 22 }}>
            Подробнее
          </p>
          <StatGrid cards={SECONDARY_STATS} stats={stats} />
        </>
      )}
    </>
  );
}

/* ============================================================
   Журнал — live-лента admin:event
   ============================================================ */

const ACTION_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Все действия' },
  { value: 'auth', label: 'Авторизация' },
  { value: 'org', label: 'Организации' },
  { value: 'member', label: 'Участники' },
  { value: 'role', label: 'Роли' },
  { value: 'invite', label: 'Приглашения' },
  { value: 'application', label: 'Заявления' },
  { value: 'dismissal', label: 'Увольнения' },
  { value: 'channel', label: 'Каналы' },
  { value: 'message', label: 'Сообщения' },
  { value: 'wallet', label: 'Кошелёк' },
  { value: 'user', label: 'Блокировки' },
];

type AuditRow = AuditItem & { fresh?: boolean };

/** Сервер фильтрует по точному совпадению или префиксу (`application` → `application.*`). */
function matchesAction(action: string, filter: string): boolean {
  if (!filter) return true;
  return action === filter || action.startsWith(`${filter}.`);
}

function AuditTab() {
  const { socket } = useApp();
  const [items, setItems] = useState<AuditRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  /* debounce поиска */
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(qInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  const load = useCallback(
    async (before?: string) => {
      setBusy(true);
      try {
        const res = await api.adminAudit({
          ...(before ? { before } : {}),
          ...(action ? { action } : {}),
          ...(q ? { q } : {}),
        });
        setItems((prev) => {
          if (!before) return res.items;
          const seen = new Set((prev ?? []).map((i) => i.id));
          return [...(prev ?? []), ...res.items.filter((i) => !seen.has(i.id))];
        });
        setHasMore(res.hasMore);
        setError(null);
      } catch (e) {
        if (!before) {
          setItems([]);
          setHasMore(false);
        }
        setError(e instanceof Error ? e.message : 'Не удалось загрузить журнал');
      } finally {
        setBusy(false);
      }
    },
    [action, q],
  );

  // фильтр/поиск изменились → перезагрузка с начала
  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  /* LIVE: admin:event → новая запись сверху с подсветкой */
  useEffect(() => {
    if (!socket) return;
    const onAdminEvent = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const item = normalizeAuditItem(payload.item ?? payload);
      if (!item) return;
      if (!matchesAction(item.action, action)) return;
      const needle = q.toLowerCase();
      if (
        needle &&
        !item.details.toLowerCase().includes(needle) &&
        !item.action.toLowerCase().includes(needle)
      ) {
        return;
      }
      setItems((prev) => {
        if (!prev) return prev;
        if (prev.some((i) => i.id === item.id)) return prev;
        return [{ ...item, fresh: true }, ...prev];
      });
    };
    socket.on('admin:event', onAdminEvent);
    return () => {
      socket.off('admin:event', onAdminEvent);
    };
  }, [socket, action, q]);

  const lastId = items && items.length > 0 ? items[items.length - 1].id : undefined;

  return (
    <>
      <p className="panel-section-title">Журнал действий</p>

      <div className="filter-row">
        <select
          className="select"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Фильтр по типу действия"
        >
          {ACTION_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="input-with-icon grow">
          <SearchIcon size={15} />
          <input
            className="input"
            value={qInput}
            placeholder="Поиск по описанию…"
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      {items === null && !error && <div className="empty-state">Загрузка…</div>}
      {items !== null && items.length === 0 && !error && (
        <div className="empty-state">Записей не найдено</div>
      )}

      {items?.map((row) => (
        <div className={row.fresh ? 'audit-row fresh' : 'audit-row'} key={row.id}>
          <span className="action-badge">{actionLabel(row.action)}</span>
          <div className="audit-main">
            <div className="audit-details">{row.details || row.action}</div>
            <div className="audit-meta">
              {dtFmt.format(row.createdAt)}
              {row.actor ? ` · ${row.actor.displayName}` : ' · Система'}
              {row.orgName ? ` · ${row.orgName}` : ''}
              {row.ip ? ` · IP ${row.ip}` : ''}
            </div>
          </div>
        </div>
      ))}

      {items && items.length > 0 && hasMore && (
        <button
          className="btn btn-ghost btn-block"
          style={{ marginTop: 12 }}
          disabled={busy}
          onClick={() => void load(lastId)}
        >
          {busy ? 'Загрузка…' : 'Показать ещё'}
        </button>
      )}
    </>
  );
}

/* ============================================================
   Входы
   ============================================================ */

/** Короткое описание устройства из User-Agent. */
function deviceLabel(ua: string | null): string {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /(iPhone|iPad|iOS)/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os ?? ua.slice(0, 40);
}

function LoginsTab() {
  const [items, setItems] = useState<LoginItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .adminLogins(50)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить входы');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <p className="panel-section-title">История входов — последние 50</p>
      {error && <div className="form-error">{error}</div>}
      {items === null && !error && <div className="empty-state">Загрузка…</div>}
      {items !== null && items.length === 0 && (
        <div className="empty-state">Входов пока нет</div>
      )}
      {items?.map((row) => (
        <div className="login-row" key={row.id}>
          {row.user ? (
            <Avatar name={row.user.displayName} color={row.user.avatarColor} size={30} />
          ) : (
            <span className="pay-icon" aria-hidden>
              <LogInIcon size={15} />
            </span>
          )}
          <div className="audit-main">
            <div className="audit-details">
              {row.user ? row.user.displayName : 'Неизвестный пользователь'}
              {row.user && <span className="muted"> @{row.user.username}</span>}
            </div>
            <div className="audit-meta">
              {dtFmt.format(row.createdAt)} · IP {row.ip ?? '—'} · {deviceLabel(row.userAgent)}
            </div>
          </div>
          <span className={row.success ? 'status-badge approved' : 'status-badge rejected'}>
            {row.success ? 'Успешно' : 'Неудачно'}
          </span>
        </div>
      ))}
    </>
  );
}

/* ============================================================
   Пользователи
   ============================================================ */

function UsersTab() {
  const { user, toast } = useApp();
  const [qInput, setQInput] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banTarget, setBanTarget] = useState<AdminUserRow | null>(null);
  const [banReason, setBanReason] = useState('');
  const [banError, setBanError] = useState<string | null>(null);
  const [banBusy, setBanBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(qInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [qInput]);

  const load = useCallback(async () => {
    try {
      setItems(await api.adminUsers(query));
      setError(null);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : 'Не удалось загрузить пользователей');
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const openBan = (target: AdminUserRow) => {
    setBanReason('');
    setBanError(null);
    setBanTarget(target);
  };

  /** SPEC v7 §35: причина обязательна (trim, 1–500), иначе сервер ответит 400. */
  const ban = async () => {
    const target = banTarget;
    if (!target) return;
    const reason = banReason.trim();
    if (reason.length < 1) {
      setBanError('Укажите причину блокировки');
      return;
    }
    if (reason.length > 500) {
      setBanError('Причина блокировки — не более 500 символов');
      return;
    }
    setBanBusy(true);
    try {
      await api.adminBan(target.id, reason);
      setBanTarget(null);
      toast(`Пользователь ${target.displayName} заблокирован`, 'success');
      await load();
    } catch (e) {
      // 400 «Укажите причину…», 409 «Владельца нельзя заблокировать» и пр. —
      // показываем серверный текст (тостом + внутри модалки).
      const message =
        e instanceof ApiError && e.status === 409
          ? e.message || 'Владельца нельзя заблокировать'
          : e instanceof Error
            ? e.message
            : 'Не удалось заблокировать';
      setBanError(message);
      toast(message, 'error');
    } finally {
      setBanBusy(false);
    }
  };

  const unban = async (target: AdminUserRow) => {
    setBusyId(target.id);
    try {
      await api.adminUnban(target.id);
      toast(`Пользователь ${target.displayName} разблокирован`, 'success');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось разблокировать', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <p className="panel-section-title">Пользователи</p>

      <div className="filter-row">
        <div className="input-with-icon grow">
          <SearchIcon size={15} />
          <input
            className="input"
            value={qInput}
            placeholder="Имя, username или почта…"
            onChange={(e) => setQInput(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}
      {items === null && !error && <div className="empty-state">Загрузка…</div>}
      {items !== null && items.length === 0 && <div className="empty-state">Ничего не найдено</div>}

      {items?.map((u) => {
        const isSelf = u.id === user?.id;
        const banTitle = u.banReason
          ? u.banByName
            ? `${u.banReason} · Забанил(а): ${u.banByName}`
            : u.banReason
          : (u.banByName ?? '');
        return (
          <div className="user-row" key={u.id}>
            <Avatar name={u.displayName} color={u.avatarColor} size={34} />
            <div className="audit-main">
              <div className="audit-details">
                {u.displayName} <span className="muted">@{u.username}</span>
                {u.isOwner && <OwnerBadge />}
                {u.banned && <span className="status-badge rejected user-badge">Заблокирован</span>}
              </div>
              {u.banned && (u.banReason || u.banByName) && (
                <div className="ban-reason" title={banTitle}>
                  Причина: {u.banReason ?? 'не указана'}
                  {u.banByName ? ` · Забанил(а): ${u.banByName}` : ''}
                </div>
              )}
              <div className="audit-meta">
                {balanceText(u.balance)} · {u.orgsCount}{' '}
                {u.orgsCount === 1 ? 'организация' : 'организаций'} · вход{' '}
                {u.lastLoginAt ? dtFmt.format(u.lastLoginAt) : 'не было'}
              </div>
            </div>
            {!isSelf &&
              (u.banned ? (
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busyId === u.id}
                  onClick={() => void unban(u)}
                >
                  Разбан
                </button>
              ) : (
                <button
                  className="btn btn-danger btn-sm"
                  disabled={busyId === u.id}
                  onClick={() => openBan(u)}
                >
                  <BanIcon size={13} /> Бан
                </button>
              ))}
          </div>
        );
      })}

      {banTarget && (
        <Modal
          title="Заблокировать пользователя?"
          subtitle={`Пользователь ${banTarget.displayName} (@${banTarget.username}) потеряет доступ.`}
          onClose={() => {
            if (!banBusy) setBanTarget(null);
          }}
          footer={
            <>
              <button className="btn btn-ghost" disabled={banBusy} onClick={() => setBanTarget(null)}>
                Отмена
              </button>
              <button
                className="btn btn-danger-filled"
                disabled={banBusy || banReason.trim().length === 0}
                onClick={() => void ban()}
              >
                {banBusy ? 'Блокировка…' : 'Заблокировать'}
              </button>
            </>
          }
        >
          <div className="field">
            <label htmlFor="ban-reason">Причина блокировки</label>
            <textarea
              id="ban-reason"
              className="textarea"
              value={banReason}
              maxLength={500}
              placeholder="Напишите, за что пользователь заблокирован…"
              onChange={(e) => {
                setBanReason(e.target.value);
                setBanError(null);
              }}
            />
            <div className="char-counter">{banReason.trim().length} / 500</div>
          </div>
          <div className="ban-warning">⚠️ активные сессии будут отключены</div>
          {banError && <div className="form-error">{banError}</div>}
        </Modal>
      )}
    </>
  );
}

/* ============================================================
   Бот
   ============================================================ */

const BOT_EVENT_LABELS: Record<string, string> = {
  'auth.login': 'Входы',
  'auth.logout': 'Выходы',
  'auth.register': 'Регистрации',
  'org.create': 'Создание организаций',
  'member.joined': 'Вступление в организацию',
  'member.left': 'Выход из организации',
  'role.changed': 'Смена ролей',
  'invite.created': 'Приглашения',
  'application.*': 'Заявления — все события',
  'dismissal.*': 'Увольнения — все события',
  'message.deleted': 'Удаление сообщений',
  'wallet.topup': 'Пополнение кошелька',
  'wallet.transfer': 'Переводы',
  'org.payroll': 'Выплаты зарплат',
  'user.ban': 'Блокировки',
};

const BOT_PREVIEW = [
  '🔴 Вход: alex_123 (IP 1.2.3.4) в 14:32',
  '📨 Заявление: Иван → ООО «Ромашка»',
  '💸 Зарплата: 50 000 ₽ → Иван (org «папа»)',
];

function BotTab() {
  const { toast, refreshDMs, selectChannel, setView } = useApp();
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .adminBot()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить настройки');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (next: BotSettings) => {
    setBusy(true);
    try {
      const saved = await api.adminBotSettings({ enabled: next.enabled, events: next.events });
      setSettings(saved);
      toast('Настройки бота сохранены', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось сохранить настройки', 'error');
    } finally {
      setBusy(false);
    }
  };

  /** Открыть ЛС с ботом: сначала ищем существующий DM, затем создаём. */
  const openBotChat = async () => {
    setChatBusy(true);
    try {
      await refreshDMs();
      const existing = (await api.listDMs()).find(
        (d) => d.peer.username === 'atrium_bot' || d.peer.id === 'u_bot',
      );
      if (existing) {
        selectChannel(existing.channel.id);
        setView('chat');
        return;
      }
      const bot = (await api.adminUsers('atrium_bot', 10)).find(
        (u) => u.username === 'atrium_bot',
      );
      if (!bot) {
        toast('Бот ещё не создан — он появится после первого отчёта', 'info');
        return;
      }
      const created = await api.openDM(bot.id);
      await refreshDMs();
      selectChannel(created.channel.id);
      setView('chat');
    } catch (e) {
      // DM бота создаётся лениво (org_id NULL) — если отчёт ещё не было, сервер ответит 400
      toast(
        e instanceof Error
          ? `${e.message}. Чат с ботом откроется после первого отчёта бота`
          : 'Не удалось открыть чат с ботом',
        'error',
      );
    } finally {
      setChatBusy(false);
    }
  };

  if (error) return <div className="form-error">{error}</div>;
  if (!settings) return <div className="empty-state">Загрузка…</div>;

  const toggleEvent = (event: string, on: boolean) => {
    const events = on
      ? [...new Set([...settings.events, event])]
      : settings.events.filter((e) => e !== event);
    setSettings({ ...settings, events });
    void save({ ...settings, events });
  };

  return (
    <>
      <p className="panel-section-title">Бот-отчётчик</p>

      <div className="info-card">
        <Toggle
          checked={settings.enabled}
          disabled={busy}
          onChange={(v) => void save({ ...settings, enabled: v })}
          label={settings.enabled ? 'Бот включён' : 'Бот выключен'}
        />
        <div className="hint" style={{ marginTop: 8 }}>
          Бот присылает отчёты в личные сообщения. Повторяющиеся события одного
          типа складываются в сводку в течение минуты.
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-ghost btn-sm" disabled={chatBusy} onClick={() => void openBotChat()}>
            <BotIcon size={14} /> {chatBusy ? 'Открытие…' : 'Открыть чат с ботом'}
          </button>
        </div>
      </div>

      <p className="panel-section-title" style={{ marginTop: 18 }}>
        События для отчётов
      </p>
      <div className="bot-checks">
        {settings.catalog.map((event) => (
          <label className="bot-check" key={event}>
            <input
              type="checkbox"
              checked={settings.events.includes(event)}
              disabled={busy}
              onChange={(e) => toggleEvent(event, e.target.checked)}
            />
            <span className="grow">{BOT_EVENT_LABELS[event] ?? event}</span>
            <code className="bot-event-code">{event}</code>
          </label>
        ))}
      </div>

      <p className="panel-section-title" style={{ marginTop: 18 }}>
        Как будет выглядеть отчёт
      </p>
      <div className="bot-preview">
        {BOT_PREVIEW.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </>
  );
}

/* ============================================================
   Экран
   ============================================================ */

export function AdminScreen({ onOpenNav }: ScreenProps) {
  const [tab, setTab] = useState<AdminTab>('overview');

  return (
    <div className="screen admin-screen">
      <div className="screen-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button className="icon-btn only-mobile" onClick={onOpenNav} title="Меню">
            <MenuIcon />
          </button>
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <ShieldIcon size={18} />
            <div style={{ minWidth: 0 }}>
              <div className="screen-title">Панель создателя</div>
              <div className="screen-sub">Статистика, журнал, пользователи и бот</div>
            </div>
          </div>
        </div>
      </div>

      <div className="admin-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'admin-tab active' : 'admin-tab'}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="list-column admin-body">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'logins' && <LoginsTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'bot' && <BotTab />}
      </div>
    </div>
  );
}
