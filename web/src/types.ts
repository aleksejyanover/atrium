/** Shared types for the Atrium web client (mirrors SPEC contract). */

/** Kind of a stored personal signature (SPEC v3 §17). */
export type SignatureKind = 'typed' | 'drawn';

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarColor: string;
  createdAt: number;
  /** ФИО для договоров (SPEC v3 §17). */
  fullName?: string | null;
  /** Сохранённая подпись: `data:image/…` (оба вида хранятся картинкой). */
  signature?: string | null;
  signatureKind?: SignatureKind | null;
  /** Текстовый вариант подписи — если сервер отдаёт его отдельно. */
  signatureText?: string | null;
  /** Superadmin-флаг, вычисляется сервером (SPEC v4 §23/§25). */
  isAdmin?: boolean;
  /** Личный баланс кошелька, целые рубли (SPEC v6 §32: и у владельца обычное число). */
  balance?: number | null;
  /** Карточка владельца: принудительный owner при вступлении (SPEC v5 §29). */
  isOwner?: boolean;
  /** Номер и пароль карты — только у владельца, только в `GET /api/me` (SPEC v6 §32). */
  card?: OwnerCard | null;
}

/** Карта владельца: видит только сам владелец (`GET /api/me` → `user.card`, SPEC v6 §32). */
export interface OwnerCard {
  /** 16 цифр. */
  number: string;
  /** 4 цифры — пароль карты, нужен при каждой операции с деньгами. */
  pin: string;
}

export type Role = 'owner' | 'assistant_owner' | 'admin' | 'assistant_admin' | 'member';

export interface RoleMeta {
  label: string;
  rank: number;
}

export const ROLE_META: Record<Role, RoleMeta> = {
  owner: { label: 'Владелец', rank: 100 },
  assistant_owner: { label: 'Помощник владельца', rank: 80 },
  admin: { label: 'Админ', rank: 60 },
  assistant_admin: { label: 'Помощник админа', rank: 40 },
  member: { label: 'Участник', rank: 20 },
};

export const ALL_ROLES: Role[] = [
  'owner',
  'assistant_owner',
  'admin',
  'assistant_admin',
  'member',
];

export function roleRank(role: Role): number {
  return ROLE_META[role]?.rank ?? 0;
}

export function roleLabel(role: Role): string {
  return ROLE_META[role]?.label ?? role;
}

export interface Org {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  membersCount: number;
  channelsCount: number;
  /** Публична ли в каталоге (SPEC v2 §14.5). */
  isPublic?: boolean;
}

export interface OrgWithRole extends Org {
  role: Role;
  unread?: number;
}

export interface OrgMember {
  user: User;
  role: Role;
  joinedAt: number;
  /** Есть pending-договор об увольнении (виден rank ≥ 40, SPEC v2 §12). */
  dismissalPending?: boolean;
}

export interface OrgDetail {
  org: Org;
  role: Role;
  members: OrgMember[];
  channels: Channel[];
  /** Кол-во входящих pending-заявлений (для rank ≥ 40, иначе 0). */
  pendingApplications?: number;
}

export interface Channel {
  id: string;
  orgId?: string;
  name: string | null;
  type: 'channel' | 'dm';
  createdAt: number;
  /** Непрочитанные сообщения (SPEC v3 §18). */
  unread?: number;
}

export interface DMEntry {
  channel: Channel;
  peer: User;
  /** Организация диалога; `null` — DM без организации (чат с ботом, SPEC v4 §23). */
  org: { id: string; name: string } | null;
}

export interface MessageSender {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
}

export interface Message {
  id: string;
  channelId: string;
  sender: MessageSender;
  text: string;
  createdAt: number;
  /** client-only marker for optimistic messages */
  pending?: boolean;
  /** echoed by the server so the sender can reconcile its optimistic copy */
  tempId?: string;
}

export interface MessagesPage {
  messages: Message[];
  hasMore: boolean;
}

export interface AuthResponse {
  token: string;
  user: User;
}

/* ---------------- invitation / contract shapes ---------------- */

/**
 * The SPEC writes user references as `{user}` which is ambiguous between a bare
 * user object and `{user: User}` — we accept both everywhere.
 */
export type UserLike = User | { user: User } | null | undefined;

/** Core invite row (inviter side / server-side invite object). */
export interface InviteCore {
  id: string;
  orgId?: string;
  role: Role;
  status?: 'pending' | 'accepted' | 'rejected' | 'canceled';
  createdAt?: number;
  contractText?: string;
  invitee?: UserLike;
  inviter?: UserLike;
}

/** An entry of `GET /api/invites` (incoming, pending). */
export interface IncomingInvite {
  invite: InviteCore;
  org: { id: string; name: string };
  inviter: UserLike;
  role: Role;
  contractText: string;
  createdAt: number;
}

/** Normalized entry of `GET /api/orgs/:id/invites` (outgoing, pending). */
export interface PendingInvite {
  id: string;
  invitee: User | null;
  inviter: User | null;
  role: Role;
  contractText: string;
  createdAt: number;
}

/* ---------------- documents (applications / dismissals), SPEC v2 §10–12 ---------------- */

export type DocumentType = 'join_application' | 'dismissal';

export type DocumentStatus =
  | 'pending'
  | 'approved'
  | 'signed'
  | 'rejected'
  | 'canceled'
  | 'terminated';

/** A row of `documents` (join application or dismissal contract). */
export interface Doc {
  id: string;
  orgId?: string;
  type?: DocumentType;
  targetUserId?: string;
  createdBy?: string;
  status: DocumentStatus;
  message?: string | null;
  contractText?: string;
  signature?: string | null;
  signatureKind?: string | null;
  signatureText?: string | null;
  signedName?: string | null;
  signedAt?: number | null;
  createdAt: number;
  resolvedAt?: number | null;
}

/** An entry of `GET /api/discover`. */
export interface DiscoverOrg {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  membersCount: number;
  isMember: boolean;
  myRole: Role | null;
}

/** An entry of `GET /api/applications/mine`. */
export interface MyApplication {
  application: Doc;
  org: { id: string; name: string; isPublic?: boolean };
}

/** Incoming application enriched with its org (staff view). */
export interface IncomingApplication {
  application: Doc;
  org: { id: string; name: string };
  user: User | null;
}

/** An entry of `GET /api/documents/mine`. */
export interface MyDocument {
  document: Doc;
  org: { id: string; name: string };
  createdBy: User | null;
}

/** An entry of `GET /api/orgs/:id/dismissals` (staff view). */
export interface OrgDismissal {
  document: Doc;
  targetUser: User | null;
  createdBy: User | null;
}

/* ---------------- activity log (SPEC v3 §18) ---------------- */

export interface ActivityEntry {
  id: string;
  orgId?: string;
  action: string;
  details: string;
  actor: User | null;
  targetUser: User | null;
  createdAt: number;
}

/* ---------------- read receipts (SPEC v3 §18) ---------------- */

export interface ReadEntry {
  userId: string;
  lastReadAt: number;
}

/* ---------------- wallet & org finance (SPEC v4 §24) ---------------- */

export type PaymentKind = 'topup' | 'transfer' | 'salary' | 'treasury_deposit';

/** An entry of `GET /api/wallet` history (as seen by the caller). */
export interface WalletPayment {
  id: string;
  kind: PaymentKind;
  amount: number;
  direction: 'in' | 'out';
  counterparty: { user: User } | { org: { id: string; name: string } } | null;
  note: string | null;
  cardMask: string | null;
  createdAt: number;
}

/** A treasury/payroll row of `GET /api/orgs/:id/finance`. */
export interface OrgFinanceTx {
  id: string;
  orgId: string | null;
  kind: PaymentKind;
  amount: number;
  note: string | null;
  cardMask: string | null;
  createdAt: number;
  fromUser: User | null;
  toUser: User | null;
}

export interface OrgFinance {
  balance: number;
  canManage: boolean;
  transactions: OrgFinanceTx[];
  payrollTotals: Array<{ user: User; total: number }>;
}

/** Русское название операции кошелька. */
export function paymentKindLabel(kind: PaymentKind): string {
  switch (kind) {
    case 'topup':
      return 'Пополнение';
    case 'transfer':
      return 'Перевод';
    case 'salary':
      return 'Зарплата';
    case 'treasury_deposit':
      return 'Казначейство';
  }
}

/* ---------------- creator panel (SPEC v4 §23) ---------------- */

export interface AdminStats {
  users: number;
  usersToday: number;
  usersActive24h: number;
  orgs: number;
  orgsPublic: number;
  members: number;
  messages: number;
  messages24h: number;
  invitesPending: number;
  callsToday: number;
  onlineNow: number;
  totalBalance: number;
  paidTotal: number;
}

export interface AuditItem {
  id: string;
  action: string;
  details: string;
  actor: User | null;
  targetUser: User | null;
  orgName: string | null;
  ip: string | null;
  createdAt: number;
}

export interface LoginItem {
  id: string;
  user: User | null;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
}

/** `GET /api/admin/users` row. */
export interface AdminUserRow extends User {
  banned: boolean;
  lastLoginAt: number | null;
  orgsCount: number;
  balance: number;
}

export interface BotSettings {
  enabled: boolean;
  /** Selected event names; server catalog uses `application.*` wildcards. */
  events: string[];
  /** Full catalog of events the bot can report on. */
  catalog: string[];
}

/* ---------------- status labels ---------------- */

/** Status of my join application (SPEC v2 §14.3). */
export function applicationStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'pending':
      return 'На рассмотрении';
    case 'approved':
      return 'Принято';
    case 'rejected':
      return 'Отклонено';
    case 'canceled':
      return 'Отозвано';
    default:
      return status;
  }
}

/** Status of a dismissal contract (SPEC v2 §14.4). */
export function documentStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'pending':
      return 'Ожидает подписи';
    case 'signed':
      return 'Подписан';
    case 'rejected':
      return 'Оспорен';
    case 'canceled':
      return 'Отменён';
    case 'terminated':
      return 'Расторгнут';
    case 'approved':
      return 'Принят';
    default:
      return status;
  }
}

/** Russian plural forms: `pluralRu(2, 'участник', 'участника', 'участников')`. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Целые рубли с пробелом в разрядах: `formatRub(12500)` → `12 500 ₽`. */
export function formatRub(n: number): string {
  const value = Math.trunc(Number(n) || 0);
  return `${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;
}

/**
 * Текст баланса для UI (SPEC v6 §32): сумма в рублях; особой отметки для
 * владельца больше нет, `null`/`undefined` трактуем как 0.
 */
export function balanceText(balance: number | null | undefined): string {
  return formatRub(balance ?? 0);
}

/* ---------------- small runtime helpers ---------------- */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Accepts both `User` and `{user: User}` (SPEC `{user}` ambiguity). */
export function unwrapUser(ref: unknown): User | null {
  if (!isRecord(ref)) return null;
  if ('user' in ref) {
    const u = ref.user;
    if (isRecord(u) && typeof u.id === 'string' && typeof u.username === 'string') {
      return u as unknown as User;
    }
  }
  if (typeof ref.id === 'string' && typeof ref.username === 'string') {
    return ref as unknown as User;
  }
  return null;
}
