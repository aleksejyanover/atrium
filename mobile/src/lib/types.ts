export type Role = 'owner' | 'assistant_owner' | 'admin' | 'assistant_admin' | 'member';

/** Saved personal signature on the user profile (SPEC v3 §17). */
export type SignatureKind = 'typed' | 'drawn';

/**
 * Signature kind stored on signed contracts:
 * v2.1 §17 uses 'png' | 'text', v3 §17 uses 'typed' | 'drawn' — accept both.
 */
export type ContractSignatureKind = 'png' | 'text' | 'typed' | 'drawn';

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarColor: string;
  createdAt?: number;
  /** ФИО для договоров (SPEC v3 §17). */
  fullName?: string | null;
  /** data:image/... сохранённая подпись. */
  signature?: string | null;
  signatureKind?: SignatureKind | null;
  /** Текст печатной подписи (SPEC v2.1 §17). */
  signatureText?: string | null;
  /** Создатель приложения (SPEC v4 §25, вычисляется сервером, только в /api/me). */
  isAdmin?: boolean;
  /** Баланс кошелька, целые рубли (SPEC v4 §25, только в /api/me). */
  balance?: number | null;
  /** Владелец платформы: бесконечный баланс, всегда owner в организациях (SPEC v5 §29). */
  isOwner?: boolean;
}

export interface Org {
  id: string;
  name: string;
  description?: string | null;
  createdAt: number;
  membersCount: number;
  channelsCount: number;
  /** Видна ли организация в каталоге (SPEC v2 §12). */
  isPublic?: boolean;
}

export interface OrgListItem extends Org {
  role: Role;
  unread?: number;
}

export interface Member {
  user: User;
  role: Role;
  joinedAt: number;
  /** Есть ли pending-договор об увольнении (видно rank ≥ 40, SPEC v2 §12). */
  dismissalPending?: boolean;
}

export interface OrgDetail {
  org: Org;
  role: Role;
  members: Member[];
  channels: Channel[];
  /** Количество входящих заявок (rank ≥ 40, иначе 0). */
  pendingApplications?: number;
}

export type ChannelType = 'channel' | 'dm';

export interface Channel {
  id: string;
  orgId: string;
  name: string | null;
  type: ChannelType;
  createdAt: number;
  /** Непрочитанных сообщений (SPEC v3 §18). */
  unread?: number;
}

export interface Message {
  id: string;
  channelId: string;
  sender: {
    id: string;
    username: string;
    displayName: string;
    avatarColor: string;
  };
  text: string;
  createdAt: number;
}

export interface Invite {
  id: string;
  orgId: string;
  invitee?: { user: User } | User;
  inviter?: { user: User } | User;
  role: Role;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled';
  contractText: string;
  createdAt: number;
}

/** Shape returned by GET /api/invites (caller's incoming pending invites). */
export interface IncomingInvite {
  invite: Invite;
  org: { id: string; name: string };
  inviter?: { user: User } | User;
  role: Role;
  contractText: string;
  createdAt: number;
}

export interface DMItem {
  channel: Channel;
  peer: User;
  org: { id: string; name: string } | null;
  /** Непрочитанных сообщений (SPEC v3 §18). */
  unread?: number;
}

export interface Paged<T> {
  messages: T[];
  hasMore: boolean;
}

export type CallKind = 'video' | 'audio';

export type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';

// ---- Документы (SPEC v2 §10–12) ------------------------------------------

export type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'canceled';

export type DismissalStatus = 'pending' | 'signed' | 'rejected' | 'canceled' | 'terminated';

export type DocumentStatus = ApplicationStatus | DismissalStatus;

export type DocumentType = 'join_application' | 'dismissal';

/** documents row → API shape (documentDto на сервере). */
export interface ContractDocument {
  id: string;
  orgId: string;
  type: DocumentType;
  targetUserId: string;
  createdBy: string;
  status: DocumentStatus;
  message?: string | null;
  contractText: string;
  signature?: string | null;
  signatureKind?: ContractSignatureKind | null;
  signatureText?: string | null;
  signedName?: string | null;
  signedAt?: number | null;
  createdAt: number;
  resolvedAt?: number | null;
}

/** GET /api/applications/mine */
export interface ApplicationItem {
  application: ContractDocument;
  org: { id: string; name: string; isPublic?: boolean };
}

/** GET /api/orgs/:id/applications */
export interface OrgApplicationItem {
  application: ContractDocument;
  user: User;
}

/** GET /api/documents/mine */
export interface DocumentItem {
  document: ContractDocument;
  org: { id: string; name: string };
  createdBy?: { user: User };
}

/** GET /api/orgs/:id/dismissals */
export interface OrgDismissalItem {
  document: ContractDocument;
  targetUser: User;
  createdBy?: { user: User };
}

// ---- Каталог (SPEC v2 §12) ------------------------------------------------

export interface DiscoverOrg {
  id: string;
  name: string;
  description?: string | null;
  createdAt: number;
  membersCount: number;
  isMember: boolean;
  myRole: Role | null;
}

// ---- История действий (SPEC v3 §18) ---------------------------------------

export interface ActivityEntry {
  id: string;
  action: string;
  details: string;
  actor: User | null;
  targetUser: User | null;
  createdAt: number;
}

// ---- Прочтено (SPEC v3 §18) -----------------------------------------------

export interface ReadEntry {
  userId: string;
  lastReadAt: number;
}

// ---- Кошелёк и финансы организации (SPEC v4 §24–25) -----------------------

export type PaymentKind = 'topup' | 'transfer' | 'salary' | 'treasury_deposit';

/** Строка payments как её отдаёт API (paymentRow на сервере). */
export interface PaymentRow {
  id: string;
  orgId: string | null;
  fromUserId: string | null;
  toUserId: string | null;
  kind: PaymentKind;
  amount: number;
  note: string | null;
  cardMask: string | null;
  createdBy: string | null;
  createdAt: number;
}

/** Операция истории кошелька (GET /api/wallet). */
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

/** GET /api/wallet */
export interface WalletInfo {
  /** У владельца сервер возвращает null — клиент рисует «∞» (SPEC v5 §29). */
  balance: number | null;
  /** Поле остаётся в API, но в UI не отображается (SPEC v5 §30). */
  demo: boolean;
  payments: WalletPayment[];
}

/** Операция по казначейству организации (GET /api/orgs/:id/finance). */
export interface OrgFinanceTx extends PaymentRow {
  fromUser: User | null;
  toUser: User | null;
}

/** GET /api/orgs/:id/finance */
export interface OrgFinance {
  balance: number;
  canManage: boolean;
  transactions: OrgFinanceTx[];
  payrollTotals: { user: User; total: number }[];
}
