/**
 * Tiny typed fetch wrapper for the Atrium REST API (SPEC §3).
 * - Bearer token from localStorage
 * - JSON in / JSON out, errors as `ApiError` with the server's Russian message
 * - automatic logout (token drop + redirect) on 401 of an authed request
 */

import type {
  AuthResponse,
  Channel,
  DMEntry,
  IncomingInvite,
  InviteCore,
  Message,
  MessagesPage,
  Org,
  OrgDetail,
  OrgWithRole,
  PendingInvite,
  Role,
  User,
  UserLike,
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

  const res = await fetch(path, { ...init, headers });

  // Auto-logout: only for requests that carried a token and were not auth attempts.
  if (res.status === 401 && token && !path.startsWith('/api/auth/')) {
    clearToken();
    if (window.location.pathname !== '/login') {
      window.location.assign('/login');
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
    return get<{ user: User }>('/api/me');
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

  createOrg(name: string, description?: string): Promise<{ org: Org; role: Role }> {
    return post<{ org: Org; role: Role }>('/api/orgs', {
      name,
      ...(description ? { description } : {}),
    });
  },

  async getOrg(id: string): Promise<OrgDetail> {
    return get<OrgDetail>(`/api/orgs/${id}`);
  },

  patchOrg(id: string, body: { name?: string; description?: string }): Promise<{ org: Org }> {
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

  acceptInvite(
    id: string,
    signatureDataUrl: string,
    signedName: string,
  ): Promise<{ org: Org; role: Role }> {
    return post<{ org: Org; role: Role }>(`/api/invites/${id}/accept`, {
      signatureDataUrl,
      signedName,
    });
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
      .map((raw) => {
        if (!isRecord(raw)) return null;
        const channel = isRecord(raw.channel) ? (raw.channel as unknown as Channel) : null;
        const peer = unwrapUser(raw.peer);
        const org = isRecord(raw.org) ? raw.org : null;
        if (!channel || !peer || !org || typeof org.id !== 'string') return null;
        return {
          channel,
          peer,
          org: { id: org.id, name: typeof org.name === 'string' ? org.name : '' },
        } satisfies DMEntry;
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
};

export type { Message };
