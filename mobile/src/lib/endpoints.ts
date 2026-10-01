import { apiFetch } from '@/lib/api';
import {
  Channel,
  DMItem,
  Invite,
  IncomingInvite,
  Member,
  Message,
  Org,
  OrgDetail,
  OrgListItem,
  Paged,
  Role,
  User,
} from '@/lib/types';

export const authApi = {
  async register(payload: {
    username: string;
    displayName: string;
    email: string;
    password: string;
  }): Promise<{ token: string; user: User }> {
    return apiFetch('/api/auth/register', { method: 'POST', body: payload });
  },
  async login(login: string, password: string): Promise<{ token: string; user: User }> {
    return apiFetch('/api/auth/login', { method: 'POST', body: { login, password } });
  },
  async me(): Promise<{ user: User }> {
    return apiFetch('/api/me');
  },
};

export const usersApi = {
  search(q: string): Promise<{ users: User[] }> {
    return apiFetch(`/api/users/search?q=${encodeURIComponent(q)}`);
  },
};

export const orgsApi = {
  list(): Promise<{ orgs: OrgListItem[] }> {
    return apiFetch('/api/orgs');
  },
  create(body: { name: string; description?: string }): Promise<{ org: Org; role: Role }> {
    return apiFetch('/api/orgs', { method: 'POST', body });
  },
  get(id: string): Promise<OrgDetail> {
    return apiFetch(`/api/orgs/${id}`);
  },
  update(id: string, body: { name?: string; description?: string }): Promise<{ org: Org }> {
    return apiFetch(`/api/orgs/${id}`, { method: 'PATCH', body });
  },
  leave(id: string): Promise<{ ok: true }> {
    return apiFetch(`/api/orgs/${id}/leave`, { method: 'POST' });
  },
  channels(id: string): Promise<{ channels: Channel[] }> {
    return apiFetch(`/api/orgs/${id}/channels`);
  },
  createChannel(id: string, name: string): Promise<{ channel: Channel }> {
    return apiFetch(`/api/orgs/${id}/channels`, { method: 'POST', body: { name } });
  },
  invites(id: string): Promise<{ invites: Invite[] }> {
    return apiFetch(`/api/orgs/${id}/invites`);
  },
  invite(id: string, usernameOrEmail: string, role: Role): Promise<{ invite: Invite }> {
    return apiFetch(`/api/orgs/${id}/invite`, {
      method: 'POST',
      body: { usernameOrEmail, role },
    });
  },
  setMemberRole(orgId: string, userId: string, role: Role): Promise<{ member: Member }> {
    return apiFetch(`/api/orgs/${orgId}/members/${userId}`, {
      method: 'PATCH',
      body: { role },
    });
  },
  removeMember(orgId: string, userId: string): Promise<{ ok: true }> {
    return apiFetch(`/api/orgs/${orgId}/members/${userId}`, { method: 'DELETE' });
  },
};

export const invitesApi = {
  /** Caller's incoming pending invites. */
  mine(): Promise<{ invites: IncomingInvite[] }> {
    return apiFetch('/api/invites');
  },
  accept(
    id: string,
    body: { signatureDataUrl: string; signedName: string },
  ): Promise<{ org: Org; role: Role }> {
    return apiFetch(`/api/invites/${id}/accept`, { method: 'POST', body });
  },
  decline(id: string): Promise<{ ok: true }> {
    return apiFetch(`/api/invites/${id}/decline`, { method: 'POST' });
  },
  cancel(id: string): Promise<{ ok: true }> {
    return apiFetch(`/api/invites/${id}`, { method: 'DELETE' });
  },
};

export const chatApi = {
  dms(): Promise<{ dms: DMItem[] }> {
    return apiFetch('/api/dms');
  },
  createDm(orgId: string, userId: string): Promise<{ channel: Channel; peer: User }> {
    return apiFetch('/api/dms', { method: 'POST', body: { orgId, userId } });
  },
  channel(id: string): Promise<{ channel: Channel; org: Org; peer?: User }> {
    return apiFetch(`/api/channels/${id}`);
  },
  messages(id: string, before?: string): Promise<Paged<Message>> {
    const q = new URLSearchParams();
    q.set('limit', '50');
    if (before) q.set('before', before);
    return apiFetch(`/api/channels/${id}/messages?${q.toString()}`);
  },
  deleteMessage(id: string): Promise<{ ok: true }> {
    return apiFetch(`/api/messages/${id}`, { method: 'DELETE' });
  },
};
