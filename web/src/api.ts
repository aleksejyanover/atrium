/**
 * Tiny typed fetch wrapper for the Atrium REST API (SPEC §3).
 * - Bearer token from localStorage
 * - JSON in / JSON out, errors as `ApiError` with the server's Russian message
 * - automatic logout (token drop + redirect) on 401 of an authed request
 */

import { apiUrl, loginUrl } from './config';
import type {
  ActivityEntry,
  AdminStats,
  AdminUserRow,
  AuditItem,
  AuthResponse,
  BankAccount,
  BankOp,
  BotSettings,
  Channel,
  DiscoverOrg,
  DMEntry,
  Doc,
  IncomingApplication,
  IncomingInvite,
  InviteCore,
  LoginItem,
  Message,
  MessagesPage,
  MyApplication,
  MyDocument,
  Org,
  OrgDetail,
  OrgDismissal,
  OrgFinance,
  OrgFinanceTx,
  OrgWithRole,
  PaymentKind,
  PendingInvite,
  ReadEntry,
  Role,
  User,
  UserLike,
  WalletPayment,
} from './types';
import { isRecord, unwrapUser } from './types';

const TOKEN_KEY = 'atrium_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function fail(message: string, status: number): never {
  throw new ApiError(message, status);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(apiUrl(path), { ...init, headers });

  // Auto-logout: only for requests that carried a token and were not auth attempts.
  if (res.status === 401 && token && !path.startsWith('/api/auth/')) {
    clearToken();
    if (!window.location.hash.startsWith('#/login')) {
      window.location.assign(loginUrl());
    }
    fail('Сессия истекла, войдите заново', 401);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message =
      isRecord(data) && typeof data.error === 'string'
        ? data.error
        : `Ошибка запроса (${res.status})`;
    fail(message, res.status);
  }

  return data as T;
}

const get = <T>(path: string): Promise<T> => request<T>(path);

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const patch = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

const del = <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' });

const put = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });

/* ---------------- normalizers for ambiguous `{user}` refs ---------------- */

function normalizeIncomingInvite(raw: unknown): IncomingInvite | null {
  if (!isRecord(raw)) return null;
  const invite = isRecord(raw.invite) ? raw.invite : raw;
  const org = isRecord(raw.org) ? raw.org : invite;
  const id = typeof invite.id === 'string' ? invite.id : null;
  const orgId = typeof org.id === 'string' ? org.id : null;
  if (!id || !orgId) return null;
  const roleRaw = typeof raw.role === 'string' ? raw.role : invite.role;
  const role: Role = typeof roleRaw === 'string' ? (roleRaw as Role) : 'member';
  const contractText =
    typeof raw.contractText === 'string'
      ? raw.contractText
      : typeof invite.contractText === 'string'
        ? invite.contractText
        : '';
  const createdAt =
    typeof raw.createdAt === 'number'
      ? raw.createdAt
      : typeof invite.createdAt === 'number'
        ? invite.createdAt
        : Date.now();
  const inviterRaw = isRecord(raw.inviter) ? raw.inviter : invite.inviter;
  return {
    invite: { ...invite, id, role } as InviteCore,
    org: { id: orgId, name: typeof org.name === 'string' ? org.name : '' },
    inviter: (inviterRaw as UserLike | undefined) ?? null,
    role,
    contractText,
    createdAt,
  };
}

function normalizePendingInvite(raw: unknown): PendingInvite | null {
  if (!isRecord(raw)) return null;
  const invite = isRecord(raw.invite) ? raw.invite : raw;
  const id = typeof invite.id === 'string' ? invite.id : null;
  if (!id) return null;
  const role = typeof invite.role === 'string' ? (invite.role as Role) : 'member';
  return {
    id,
    invitee: unwrapUser(invite.invitee ?? raw.invitee),
    inviter: unwrapUser(invite.inviter ?? raw.inviter),
    role,
    contractText:
      typeof invite.contractText === 'string'
        ? invite.contractText
        : typeof raw.contractText === 'string'
          ? raw.contractText
          : '',
    createdAt:
      typeof invite.createdAt === 'number'
        ? invite.createdAt
        : typeof raw.createdAt === 'number'
          ? raw.createdAt
          : Date.now(),
  };
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * `balance` из ответов кошелька/профиля (SPEC v6 §32): обычное число.
 * `null`/кривые значения (устаревший кэш) → fallback.
 */
function normalizeBalance(raw: unknown, fallback: number = 0): number {
  return typeof raw === 'number' ? raw : fallback;
}

/** `GET /api/me` user (SPEC v6 §32): `isOwner`, обычный `balance`, `card:{number,pin}` у владельца. */
function normalizeSelfUser(raw: unknown): User {
  const user = unwrapUser(raw);
  if (!user) fail('Некорректный ответ сервера', 500);
  if (!isRecord(raw)) return user;
  const next: User = { ...user };
  if (raw.balance !== undefined) next.balance = normalizeBalance(raw.balance);
  if (
    isRecord(raw.card) &&
    typeof raw.card.number === 'string' &&
    typeof raw.card.pin === 'string'
  ) {
    next.card = { number: raw.card.number, pin: raw.card.pin };
  }
  return next;
}

/**
 * Normalizes a `documents` row (application / dismissal). The SPEC writes the
 * SQL columns in snake_case but the REST contract everywhere else is camelCase —
 * we tolerate both spellings so the UI never breaks on a naming mismatch.
 */
function normalizeDoc(raw: unknown): Doc | null {
  if (!isRecord(raw)) return null;
  const d = (isRecord(raw.application) ? raw.application : isRecord(raw.document) ? raw.document : raw) as Record<string, unknown>;
  if (typeof d.id !== 'string') return null;
  const pick = (camel: string, snake: string): unknown => (d[camel] !== undefined ? d[camel] : d[snake]);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const statusRaw = str(pick('status', 'status'));
  const status = (statusRaw ?? 'pending') as Doc['status'];
  return {
    id: d.id,
    orgId: str(pick('orgId', 'org_id')) ?? undefined,
    type: (str(pick('type', 'type')) as Doc['type']) ?? undefined,
    targetUserId: str(pick('targetUserId', 'target_user_id')) ?? undefined,
    createdBy: str(pick('createdBy', 'created_by')) ?? undefined,
    status,
    message: str(pick('message', 'message')),
    contractText: str(pick('contractText', 'contract_text')) ?? undefined,
    signature: str(pick('signature', 'signature')),
    signatureKind: str(pick('signatureKind', 'signature_kind')),
    signatureText: str(pick('signatureText', 'signature_text')),
    signedName: str(pick('signedName', 'signed_name')),
    signedAt: num(pick('signedAt', 'signed_at')),
    createdAt: num(pick('createdAt', 'created_at')) ?? Date.now(),
    resolvedAt: num(pick('resolvedAt', 'resolved_at')),
  };
}

function docOf(raw: unknown): Doc | null {
  return normalizeDoc(raw);
}

function normalizeActivity(raw: unknown): ActivityEntry | null {
  if (!isRecord(raw)) return null;
  const a = isRecord(raw.activity) ? raw.activity : raw;
  if (typeof a.id !== 'string') return null;
  const orgId = typeof a.orgId === 'string' ? a.orgId : typeof a.org_id === 'string' ? a.org_id : undefined;
  const createdAt =
    typeof a.createdAt === 'number' ? a.createdAt : typeof a.created_at === 'number' ? a.created_at : Date.now();
  return {
    id: a.id,
    orgId,
    action: typeof a.action === 'string' ? a.action : '',
    details: typeof a.details === 'string' ? a.details : '',
    actor: unwrapUser(a.actor),
    targetUser: unwrapUser(a.targetUser ?? a.target_user),
    createdAt,
  };
}

function normalizeWalletPayment(raw: unknown): WalletPayment | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  const kind = raw.kind;
  if (
    kind !== 'topup' &&
    kind !== 'transfer' &&
    kind !== 'salary' &&
    kind !== 'treasury_deposit' &&
    kind !== 'bank_withdraw' &&
    kind !== 'bank_topup'
  ) {
    return null;
  }
  const cp = isRecord(raw.counterparty) ? raw.counterparty : null;
  const cpUser = cp ? unwrapUser(cp.user) : null;
  const cpOrg = cp && isRecord(cp.org) ? cp.org : null;
  const counterparty: WalletPayment['counterparty'] = cpUser
    ? { user: cpUser }
    : cpOrg && typeof cpOrg.id === 'string'
      ? { org: { id: cpOrg.id, name: typeof cpOrg.name === 'string' ? cpOrg.name : '' } }
      : null;
  return {
    id: raw.id,
    kind,
    amount: typeof raw.amount === 'number' ? raw.amount : 0,
    direction: raw.direction === 'out' ? 'out' : 'in',
    counterparty,
    note: typeof raw.note === 'string' ? raw.note : null,
    cardMask: typeof raw.cardMask === 'string' ? raw.cardMask : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

/* ---------------- normalizers for v4 finance & creator panel ---------------- */

const PAYMENT_KINDS: readonly string[] = ['topup', 'transfer', 'salary', 'treasury_deposit'];

function isPaymentKind(v: unknown): v is PaymentKind {
  return typeof v === 'string' && PAYMENT_KINDS.includes(v);
}

/** `GET /api/orgs/:id/finance` transaction row → `OrgFinanceTx`. */
function normalizeFinanceTx(raw: unknown): OrgFinanceTx | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !isPaymentKind(raw.kind)) return null;
  return {
    id: raw.id,
    orgId: typeof raw.orgId === 'string' ? raw.orgId : null,
    kind: raw.kind,
    amount: typeof raw.amount === 'number' ? raw.amount : 0,
    note: typeof raw.note === 'string' ? raw.note : null,
    cardMask: typeof raw.cardMask === 'string' ? raw.cardMask : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    fromUser: unwrapUser(raw.fromUser),
    toUser: unwrapUser(raw.toUser),
  };
}

/** audit_log row (also the payload of `admin:event`) → `AuditItem`. */
export function normalizeAuditItem(raw: unknown): AuditItem | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    action: typeof raw.action === 'string' ? raw.action : '',
    details: typeof raw.details === 'string' ? raw.details : '',
    actor: unwrapUser(raw.actor),
    targetUser: unwrapUser(raw.targetUser),
    orgName: typeof raw.orgName === 'string' ? raw.orgName : null,
    ip: typeof raw.ip === 'string' ? raw.ip : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

/** login_log row → `LoginItem`. */
function normalizeLoginItem(raw: unknown): LoginItem | null {
  if (!isRecord(raw) || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    user: unwrapUser(raw.user),
    success: raw.success === true,
    ip: typeof raw.ip === 'string' ? raw.ip : null,
    userAgent: typeof raw.userAgent === 'string' ? raw.userAgent : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
}

/** `GET /api/admin/users` row → `AdminUserRow`. */
function normalizeAdminUser(raw: unknown): AdminUserRow | null {
  const u = unwrapUser(raw);
  if (!u || !isRecord(raw)) return null;
  return {
    ...u,
    banned: raw.banned === true,
    banReason: typeof raw.banReason === 'string' ? raw.banReason : null,
    banByName: typeof raw.banByName === 'string' ? raw.banByName : null,
    lastLoginAt: typeof raw.lastLoginAt === 'number' ? raw.lastLoginAt : null,
    orgsCount: typeof raw.orgsCount === 'number' ? raw.orgsCount : 0,
    balance: typeof raw.balance === 'number' ? raw.balance : 0,
  };
}

/* ---------------- API ---------------- */

export const api = {
  /* auth */
  register(input: {
    username: string;
    displayName: string;
    email: string;
    password: string;
  }): Promise<AuthResponse> {
    return post<AuthResponse>('/api/auth/register', input);
  },

  login(login: string, password: string): Promise<AuthResponse> {
    return post<AuthResponse>('/api/auth/login', { login, password });
  },

  me(): Promise<{ user: User }> {
    return get<{ user: unknown }>('/api/me').then((res) => ({
      user: normalizeSelfUser(res.user),
    }));
  },

  /** Активация карточки владельца (SPEC v5 §29): 400 → «Неверный код». */
  ownerClaim(code: string): Promise<{ ok: true; isOwner?: boolean; already?: boolean }> {
    return post<{ ok: true; isOwner?: boolean; already?: boolean }>('/api/owner/claim', { code });
  },

  /** Update profile / password / signature (SPEC v3 §17 — PATCH /api/me). */
  patchMe(body: {
    displayName?: string;
    fullName?: string;
    email?: string;
    signature?: string | null;
    signatureKind?: 'typed' | 'drawn' | null;
    currentPassword?: string;
    password?: string;
  }): Promise<{ user: User }> {
    return patch<{ user: User }>('/api/me', body);
  },

  /** Drop the saved personal signature (signature + kind → null). */
  clearSignature(): Promise<{ user: User }> {
    return patch<{ user: User }>('/api/me', { signature: null, signatureKind: null });
  },

  /* users */
  async searchUsers(q: string): Promise<User[]> {
    const res = await get<{ users: unknown }>(`/api/users/search?q=${encodeURIComponent(q)}`);
    return asArray(res.users)
      .map(unwrapUser)
      .filter((u): u is User => u !== null);
  },

  /* organizations */
  async listOrgs(): Promise<OrgWithRole[]> {
    const res = await get<{ orgs: unknown }>('/api/orgs');
    return asArray(res.orgs) as OrgWithRole[];
  },

  createOrg(
    name: string,
    description?: string,
    isPublic?: boolean,
  ): Promise<{ org: Org; role: Role }> {
    return post<{ org: Org; role: Role }>('/api/orgs', {
      name,
      ...(description ? { description } : {}),
      ...(isPublic === undefined ? {} : { isPublic }),
    });
  },

  async getOrg(id: string): Promise<OrgDetail> {
    return get<OrgDetail>(`/api/orgs/${id}`);
  },

  patchOrg(
    id: string,
    body: { name?: string; description?: string; isPublic?: boolean },
  ): Promise<{ org: Org }> {
    return patch<{ org: Org }>(`/api/orgs/${id}`, body);
  },

  leaveOrg(id: string): Promise<{ ok: true }> {
    return post<{ ok: true }>(`/api/orgs/${id}/leave`);
  },

  /* invitations + contract */
  invite(
    orgId: string,
    usernameOrEmail: string,
    role: Role,
  ): Promise<{ invite: InviteCore }> {
    return post<{ invite: InviteCore }>(`/api/orgs/${orgId}/invite`, { usernameOrEmail, role });
  },

  async listIncomingInvites(): Promise<IncomingInvite[]> {
    const res = await get<{ invites: unknown }>('/api/invites');
    return asArray(res.invites)
      .map(normalizeIncomingInvite)
      .filter((i): i is IncomingInvite => i !== null);
  },

  async listOrgInvites(orgId: string): Promise<PendingInvite[]> {
    const res = await get<{ invites: unknown }>(`/api/orgs/${orgId}/invites`);
    return asArray(res.invites)
      .map(normalizePendingInvite)
      .filter((i): i is PendingInvite => i !== null);
  },

  /**
   * Sign the join contract. The signature is EITHER a drawn/typed image
   * (`signatureDataUrl`) OR a text signature (`signatureText`) — SPEC v3 §17.
   */
  acceptInvite(
    id: string,
    signature: { signatureDataUrl?: string; signatureText?: string; signedName: string },
  ): Promise<{ org: Org; role: Role }> {
    return post<{ org: Org; role: Role }>(`/api/invites/${id}/accept`, signature);
  },

  declineInvite(id: string): Promise<{ ok: true }> {
    return post<{ ok: true }>(`/api/invites/${id}/decline`);
  },

  cancelInvite(id: string): Promise<{ ok: true }> {
    return del<{ ok: true }>(`/api/invites/${id}`);
  },

  /* members */
  setMemberRole(orgId: string, userId: string, role: Role): Promise<{ member: unknown }> {
    return patch<{ member: unknown }>(`/api/orgs/${orgId}/members/${userId}`, { role });
  },

  removeMember(orgId: string, userId: string): Promise<{ ok: true }> {
    return del<{ ok: true }>(`/api/orgs/${orgId}/members/${userId}`);
  },

  /* ---------------- catalog of organizations (SPEC v2 §14.1) ---------------- */

  async discover(q?: string): Promise<DiscoverOrg[]> {
    const res = await get<{ orgs: unknown }>(
      q ? `/api/discover?q=${encodeURIComponent(q)}` : '/api/discover',
    );
    return asArray(res.orgs) as DiscoverOrg[];
  },

  /* ---------------- join applications (SPEC v2 §14.3) ---------------- */

  createApplication(
    orgId: string,
    body: {
      message?: string;
      signatureDataUrl?: string;
      signatureText?: string;
      signedName: string;
    },
  ): Promise<{ application: Doc }> {
    return post<{ application: Doc }>(`/api/orgs/${orgId}/applications`, body);
  },

  async myApplications(): Promise<MyApplication[]> {
    const res = await get<{ applications: unknown }>('/api/applications/mine');
    return asArray(res.applications)
      .map((raw): MyApplication | null => {
        if (!isRecord(raw)) return null;
        const application = docOf(raw.application ?? raw);
        const org = isRecord(raw.org) ? raw.org : null;
        if (!application || !org || typeof org.id !== 'string') return null;
        return {
          application,
          org: {
            id: org.id,
            name: typeof org.name === 'string' ? org.name : '',
            ...(typeof org.isPublic === 'boolean' ? { isPublic: org.isPublic } : {}),
          },
        };
      })
      .filter((x): x is MyApplication => x !== null);
  },

  async orgApplications(orgId: string): Promise<IncomingApplication[]> {
    const res = await get<{ applications: unknown }>(`/api/orgs/${orgId}/applications`);
    return asArray(res.applications)
      .map((raw): IncomingApplication | null => {
        if (!isRecord(raw)) return null;
        const application = docOf(raw.application ?? raw);
        if (!application) return null;
        const org = isRecord(raw.org) ? raw.org : null;
        return {
          application,
          org: {
            id:
              typeof org?.id === 'string'
                ? org.id
                : typeof application.orgId === 'string'
                  ? application.orgId
                  : orgId,
            name: typeof org?.name === 'string' ? org.name : '',
          },
          user: unwrapUser(raw.user),
        };
      })
      .filter((x): x is IncomingApplication => x !== null);
  },

  acceptApplication(id: string): Promise<{ application: Doc }> {
    return post<{ application: Doc }>(`/api/applications/${id}/accept`);
  },

  rejectApplication(id: string): Promise<{ application: Doc }> {
    return post<{ application: Doc }>(`/api/applications/${id}/reject`);
  },

  cancelApplication(id: string): Promise<{ application: Doc }> {
    return post<{ application: Doc }>(`/api/applications/${id}/cancel`);
  },

  /* ---------------- dismissals (SPEC v2 §14.6) ---------------- */

  createDismissal(
    orgId: string,
    body: { userId: string; reason?: string },
  ): Promise<{ document: Doc }> {
    return post<{ document: Doc }>(`/api/orgs/${orgId}/dismissals`, body);
  },

  async myDocuments(): Promise<MyDocument[]> {
    const res = await get<{ documents: unknown }>('/api/documents/mine');
    return asArray(res.documents)
      .map((raw) => {
        if (!isRecord(raw)) return null;
        const document = docOf(raw.document ?? raw);
        const org = isRecord(raw.org) ? raw.org : null;
        if (!document || !org || typeof org.id !== 'string') return null;
        return {
          document,
          org: { id: org.id, name: typeof org.name === 'string' ? org.name : '' },
          createdBy: unwrapUser(raw.createdBy ?? raw.created_by),
        } satisfies MyDocument;
      })
      .filter((x): x is MyDocument => x !== null);
  },

  async orgDismissals(orgId: string): Promise<OrgDismissal[]> {
    const res = await get<{ documents: unknown }>(`/api/orgs/${orgId}/dismissals`);
    return asArray(res.documents)
      .map((raw) => {
        if (!isRecord(raw)) return null;
        const document = docOf(raw.document ?? raw);
        if (!document) return null;
        return {
          document,
          targetUser: unwrapUser(raw.targetUser ?? raw.target_user),
          createdBy: unwrapUser(raw.createdBy ?? raw.created_by),
        } satisfies OrgDismissal;
      })
      .filter((x): x is OrgDismissal => x !== null);
  },

  signDocument(
    id: string,
    body: { signatureDataUrl?: string; signatureText?: string; signedName: string },
  ): Promise<{ document: Doc }> {
    return post<{ document: Doc }>(`/api/documents/${id}/sign`, body);
  },

  rejectDocument(id: string): Promise<{ document: Doc }> {
    return post<{ document: Doc }>(`/api/documents/${id}/reject`);
  },

  cancelDocument(id: string): Promise<{ document: Doc }> {
    return post<{ document: Doc }>(`/api/documents/${id}/cancel`);
  },

  terminateDocument(id: string): Promise<{ document: Doc }> {
    return post<{ document: Doc }>(`/api/documents/${id}/terminate`);
  },

  /* channels & messages */
  async listChannels(orgId: string): Promise<Channel[]> {
    const res = await get<{ channels: unknown }>(`/api/orgs/${orgId}/channels`);
    return asArray(res.channels) as Channel[];
  },

  createChannel(orgId: string, name: string): Promise<{ channel: Channel }> {
    return post<{ channel: Channel }>(`/api/orgs/${orgId}/channels`, { name });
  },

  async listDMs(): Promise<DMEntry[]> {
    const res = await get<{ dms: unknown }>('/api/dms');
    return asArray(res.dms)
      .map((raw): DMEntry | null => {
        if (!isRecord(raw)) return null;
        const channel = isRecord(raw.channel) ? (raw.channel as unknown as Channel) : null;
        const peer = unwrapUser(raw.peer);
        if (!channel || !peer) return null;
        // `org` is null for org-less DMs (chat with the Atrium bot, SPEC v4 §23)
        const orgRaw = isRecord(raw.org) ? raw.org : null;
        const org =
          orgRaw && typeof orgRaw.id === 'string'
            ? { id: orgRaw.id, name: typeof orgRaw.name === 'string' ? orgRaw.name : '' }
            : null;
        const unread = typeof raw.unread === 'number' ? raw.unread : channel.unread;
        return { channel: { ...channel, unread }, peer, org } satisfies DMEntry;
      })
      .filter((d): d is DMEntry => d !== null);
  },

  createDM(orgId: string, userId: string): Promise<{ channel: Channel; peer: User }> {
    return post<{ channel: Channel; peer: User }>('/api/dms', { orgId, userId });
  },

  getMessages(
    channelId: string,
    before?: string,
    limit = 50,
  ): Promise<MessagesPage> {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    params.set('limit', String(limit));
    return get<MessagesPage>(`/api/channels/${channelId}/messages?${params.toString()}`);
  },

  deleteMessage(id: string): Promise<{ ok: true }> {
    return del<{ ok: true }>(`/api/messages/${id}`);
  },

  /* ---------------- read receipts (SPEC v3 §18) ---------------- */

  markRead(channelId: string, at?: number): Promise<{ ok: true }> {
    return post<{ ok: true }>(`/api/channels/${channelId}/read`, at ? { at } : {});
  },

  async readStatus(channelId: string): Promise<ReadEntry[]> {
    const res = await get<{ reads: unknown }>(`/api/channels/${channelId}/read-status`);
    return asArray(res.reads)
      .map((raw) => {
        if (!isRecord(raw)) return null;
        const userId =
          typeof raw.userId === 'string' ? raw.userId : typeof raw.user_id === 'string' ? raw.user_id : null;
        const lastReadAt =
          typeof raw.lastReadAt === 'number'
            ? raw.lastReadAt
            : typeof raw.last_read_at === 'number'
              ? raw.last_read_at
              : null;
        if (!userId || lastReadAt === null) return null;
        return { userId, lastReadAt } satisfies ReadEntry;
      })
      .filter((x): x is ReadEntry => x !== null);
  },

  /* ---------------- activity log (SPEC v3 §18) ---------------- */

  async activity(
    orgId: string,
    before?: string,
    limit = 50,
  ): Promise<{ activity: ActivityEntry[]; hasMore: boolean }> {
    const params = new URLSearchParams();
    if (before) params.set('before', before);
    params.set('limit', String(limit));
    const res = await get<{ activity: unknown; hasMore?: boolean }>(
      `/api/orgs/${orgId}/activity?${params.toString()}`,
    );
    return {
      activity: asArray(res.activity)
        .map(normalizeActivity)
        .filter((a): a is ActivityEntry => a !== null),
      hasMore: res.hasMore === true,
    };
  },

  /* ---------------- wallet (SPEC v4 §24) ---------------- */

  async wallet(): Promise<{ balance: number; demo: boolean; payments: WalletPayment[] }> {
    const res = await get<{ balance: unknown; demo?: unknown; payments: unknown }>('/api/wallet');
    return {
      // SPEC v6 §32: баланс — обычное число (и у владельца); `demo` никогда не показываем
      balance: normalizeBalance(res.balance),
      demo: res.demo !== false,
      payments: asArray(res.payments)
        .map(normalizeWalletPayment)
        .filter((p): p is WalletPayment => p !== null),
    };
  },

  /**
   * Зачисление на счёт (карта → маска в истории операций).
   * `pin` обязателен для владельца (SPEC v6 §32), остальным не передаётся.
   */
  walletTopup(amount: number, cardNumber: string, pin?: string): Promise<{ balance: number }> {
    return post<{ balance: number }>('/api/wallet/topup', {
      amount,
      cardNumber,
      ...(pin ? { pin } : {}),
    });
  },

  walletTransfer(
    toUserId: string,
    amount: number,
    note?: string,
    pin?: string,
  ): Promise<{ balance: number }> {
    return post<{ balance: number }>('/api/wallet/transfer', {
      toUserId,
      amount,
      ...(note ? { note } : {}),
      ...(pin ? { pin } : {}),
    });
  },

  /* ---- банковский счёт (SPEC v9 §40) ---- */

  /** Привязанный счёт + операции по нему. */
  getBank(): Promise<{ account: BankAccount | null; ops: BankOp[] }> {
    return get<{ account: BankAccount | null; ops: BankOp[] }>('/api/wallet/bank');
  },

  /** Привязать/заменить банковский счёт (номер не сохраняется — только маска). */
  linkBankAccount(
    number: string,
    holder: string,
    bank: string,
  ): Promise<{ ok: true; account: BankAccount }> {
    return post<{ ok: true; account: BankAccount }>('/api/wallet/bank/account', {
      number,
      holder,
      bank,
    });
  },

  unlinkBankAccount(): Promise<{ ok: true }> {
    return del<{ ok: true }>('/api/wallet/bank/account');
  },

  /** Вывод на привязанную карту; `pin` обязателен для владельца (§32–33). */
  bankWithdraw(
    amount: number,
    pin?: string,
  ): Promise<{ ok: true; op: BankOp; balance: number }> {
    return post<{ ok: true; op: BankOp; balance: number }>('/api/wallet/bank/withdraw', {
      amount,
      ...(pin ? { pin } : {}),
    });
  },

  /** Пополнение счёта в приложении с привязанной банковской карты (PIN не нужен). */
  bankTopup(amount: number): Promise<{ ok: true; op: BankOp; balance: number }> {
    return post<{ ok: true; op: BankOp; balance: number }>('/api/wallet/bank/topup', {
      amount,
    });
  },

  /** Treasury of an org (rank ≥ 60) or my own credits from it (member). */
  async orgFinance(orgId: string): Promise<OrgFinance> {
    const res = await get<{
      balance: unknown;
      canManage: unknown;
      transactions: unknown;
      payrollTotals: unknown;
    }>(`/api/orgs/${orgId}/finance`);
    const totals = asArray(res.payrollTotals)
      .map((raw): { user: User; total: number } | null => {
        if (!isRecord(raw)) return null;
        const user = unwrapUser(raw.user);
        if (!user) return null;
        return { user, total: typeof raw.total === 'number' ? raw.total : 0 };
      })
      .filter((t): t is { user: User; total: number } => t !== null);
    return {
      balance: typeof res.balance === 'number' ? res.balance : 0,
      canManage: res.canManage === true,
      transactions: asArray(res.transactions)
        .map(normalizeFinanceTx)
        .filter((t): t is OrgFinanceTx => t !== null),
      payrollTotals: totals,
    };
  },

  /**
   * Move funds from my personal balance into the org treasury (rank ≥ 60).
   * `pin` обязателен для владельца (SPEC v6 §32).
   */
  treasuryDeposit(
    orgId: string,
    amount: number,
    pin?: string,
  ): Promise<{ balance: number; userBalance: number }> {
    return post<{ balance: number; userBalance: number }>(
      `/api/orgs/${orgId}/treasury/deposit`,
      { amount, ...(pin ? { pin } : {}) },
    );
  },

  /** Pay a salary from the treasury (rank ≥ 60); `pin` обязателен для владельца. */
  payroll(
    orgId: string,
    body: { userId: string; amount: number; note?: string; pin?: string },
  ): Promise<{ orgBalance: number }> {
    return post<{ orgBalance: number }>(`/api/orgs/${orgId}/payroll`, body);
  },

  /* ---------------- creator panel (SPEC v4 §23) ---------------- */

  adminStats(): Promise<AdminStats> {
    return get<AdminStats>('/api/admin/stats');
  },

  async adminAudit(opts: {
    before?: string;
    limit?: number;
    action?: string;
    q?: string;
  }): Promise<{ items: AuditItem[]; hasMore: boolean }> {
    const params = new URLSearchParams();
    if (opts.before) params.set('before', opts.before);
    params.set('limit', String(opts.limit ?? 50));
    if (opts.action) params.set('action', opts.action);
    if (opts.q) params.set('q', opts.q);
    const res = await get<{ items: unknown; hasMore?: boolean }>(
      `/api/admin/audit?${params.toString()}`,
    );
    return {
      items: asArray(res.items)
        .map(normalizeAuditItem)
        .filter((i): i is AuditItem => i !== null),
      hasMore: res.hasMore === true,
    };
  },

  async adminLogins(limit = 50): Promise<LoginItem[]> {
    const res = await get<{ items: unknown }>(`/api/admin/logins?limit=${limit}`);
    return asArray(res.items)
      .map(normalizeLoginItem)
      .filter((i): i is LoginItem => i !== null);
  },

  async adminUsers(query: string, limit = 30): Promise<AdminUserRow[]> {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    params.set('limit', String(limit));
    const res = await get<{ items: unknown }>(`/api/admin/users?${params.toString()}`);
    return asArray(res.items)
      .map(normalizeAdminUser)
      .filter((u): u is AdminUserRow => u !== null);
  },

  /** SPEC v7 §35: `{reason}` обязателен (trim, 1–500), иначе 400 «Укажите причину блокировки». */
  adminBan(id: string, reason: string): Promise<{ ok: true; banned: true }> {
    return post<{ ok: true; banned: true }>(`/api/admin/users/${id}/ban`, { reason });
  },

  adminUnban(id: string): Promise<{ ok: true; banned: false }> {
    return post<{ ok: true; banned: false }>(`/api/admin/users/${id}/unban`);
  },

  adminBot(): Promise<BotSettings> {
    return get<BotSettings>('/api/admin/bot');
  },

  adminBotSettings(body: { enabled?: boolean; events?: string[] }): Promise<BotSettings> {
    return put<BotSettings>('/api/admin/bot', body);
  },

  /**
   * Try to open (find-or-create) a DM with a user. The bot DM has no org and
   * is created lazily by the server on the first bot report — for a brand new
   * bot the request can fail with 400 «Укажите организацию и пользователя».
   */
  openDM(userId: string): Promise<{ channel: Channel; peer: User }> {
    return post<{ channel: Channel; peer: User }>('/api/dms', { userId });
  },

  /* ---------------- channel moderator bot (SPEC v9 §37) ---------------- */

  /**
   * Добавить бота-модератора в канал (права: участник канала rank ≥ 60) —
   * `POST /api/orgs/:orgId/channels/:channelId/bot` → `{ok, already?}`;
   * 403/404 приходят с русским текстом и показываются тостом.
   */
  addChannelBot(orgId: string, channelId: string): Promise<{ ok: true; already?: boolean }> {
    return post<{ ok: true; already?: boolean }>(
      `/api/orgs/${orgId}/channels/${channelId}/bot`,
    );
  },

  /** Убрать бота-модератора из канала (те же права) → `{ok:true}`. */
  removeChannelBot(orgId: string, channelId: string): Promise<{ ok: true }> {
    return del<{ ok: true }>(`/api/orgs/${orgId}/channels/${channelId}/bot`);
  },

  /**
   * Статус бота в канале: `GET …/bot` → `{inChannel:boolean}`.
   * Терпимо к полю `botInChannel` в списочных ответах, если сервер его добавит.
   */
  async channelBotStatus(orgId: string, channelId: string): Promise<boolean> {
    const res = await get<{ inChannel?: unknown; botInChannel?: unknown }>(
      `/api/orgs/${orgId}/channels/${channelId}/bot`,
    );
    const value = res.inChannel !== undefined ? res.inChannel : res.botInChannel;
    return value === true;
  },

  /**
   * Оценка переписки (SPEC v9 §37.8): бот публикует в канал
   * «📊 Оценка переписки: …» (права: участник канала rank ≥ 60).
   */
  channelModerationRating(orgId: string, channelId: string): Promise<{ ok: true }> {
    return post<{ ok: true }>(`/api/orgs/${orgId}/channels/${channelId}/moderation/rating`);
  },
};

export type { Message };
