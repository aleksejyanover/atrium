import { apiFetch } from '@/lib/api';
import {
  ActivityEntry,
  ApplicationItem,
  Channel,
  ContractDocument,
  DMItem,
  DiscoverOrg,
  DocumentItem,
  IncomingInvite,
  Invite,
  Member,
  Message,
  Org,
  OrgApplicationItem,
  OrgDetail,
  OrgDismissalItem,
  OrgFinance,
  OrgListItem,
  Paged,
  PaymentRow,
  ReadEntry,
  Role,
  User,
  WalletInfo,
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

/** Профиль и личная подпись (SPEC v3 §17). */
export interface MeUpdatePayload {
  displayName?: string;
  fullName?: string;
  email?: string;
  password?: string;
  currentPassword?: string;
  signature?: string | null;
  signatureKind?: 'typed' | 'drawn' | null;
  signatureText?: string | null;
}

export const meApi = {
  update(body: MeUpdatePayload): Promise<{ user: User }> {
    return apiFetch('/api/me', { method: 'PATCH', body });
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
  create(body: {
    name: string;
    description?: string;
    isPublic?: boolean;
  }): Promise<{ org: Org; role: Role }> {
    return apiFetch('/api/orgs', { method: 'POST', body });
  },
  get(id: string): Promise<OrgDetail> {
    return apiFetch(`/api/orgs/${id}`);
  },
  update(
    id: string,
    body: { name?: string; description?: string; isPublic?: boolean },
  ): Promise<{ org: Org }> {
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
  /** Только для API-совместимости — в UI v2 увольнения идут через dismissal-документы. */
  removeMember(orgId: string, userId: string): Promise<{ ok: true }> {
    return apiFetch(`/api/orgs/${orgId}/members/${userId}`, { method: 'DELETE' });
  },
  /** История действий организации (SPEC v3 §18). */
  activity(id: string, before?: string): Promise<{ activity: ActivityEntry[]; hasMore: boolean }> {
    const q = new URLSearchParams();
    q.set('limit', '50');
    if (before) q.set('before', before);
    return apiFetch(`/api/orgs/${id}/activity?${q.toString()}`);
  },
  /** Финансы организации (SPEC v4 §24): казначейство rank≥60 / мои начисления. */
  finance(id: string): Promise<OrgFinance> {
    return apiFetch(`/api/orgs/${id}/finance`);
  },
  /** Пополнить казначейство — списывает с личного баланса автора (rank ≥ 60). */
  treasuryDeposit(id: string, amount: number): Promise<{ balance: number }> {
    return apiFetch(`/api/orgs/${id}/treasury/deposit`, {
      method: 'POST',
      body: { amount },
    });
  },
  /** Выплатить зарплату из казначейства (rank ≥ 60). */
  payroll(
    id: string,
    body: { userId: string; amount: number; note?: string },
  ): Promise<{ orgBalance: number; payment: PaymentRow }> {
    return apiFetch(`/api/orgs/${id}/payroll`, { method: 'POST', body });
  },
};

/** Кошелёк: баланс, пополнение счёта картой, переводы (SPEC v4 §24). */
export const walletApi = {
  get(): Promise<WalletInfo> {
    return apiFetch('/api/wallet');
  },
  /** Пополнить счёт картой (SPEC v5 §30 — нейтральные банковские тексты). */
  topup(body: { amount: number; cardNumber: string }): Promise<{
    balance: number | null;
    demo: boolean;
  }> {
    return apiFetch('/api/wallet/topup', { method: 'POST', body });
  },
  transfer(body: { toUserId: string; amount: number; note?: string }): Promise<{
    balance: number | null;
    payment: PaymentRow;
  }> {
    return apiFetch('/api/wallet/transfer', { method: 'POST', body });
  },
};

/** Карточка владельца (SPEC v5 §29): POST /api/owner/claim {code}. */
export const ownerApi = {
  claim(code: string): Promise<{ ok: true; isOwner?: boolean; already?: boolean }> {
    return apiFetch('/api/owner/claim', { method: 'POST', body: { code } });
  },
};

/** Каталог публичных организаций (SPEC v2 §12). */
export const discoverApi = {
  search(q: string): Promise<{ orgs: DiscoverOrg[] }> {
    const query = q.trim();
    return apiFetch(`/api/discover${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  },
};

/** Подпись контракта: рисунок (data:image/...) и/или текст (SPEC v2.1/v3 §17). */
export interface ContractSignaturePayload {
  signatureDataUrl: string;
  signatureText?: string;
  signedName: string;
}

/** Заявления на вступление (SPEC v2 §12, documents.type='join_application'). */
export const applicationsApi = {
  submit(
    orgId: string,
    body: { message?: string } & ContractSignaturePayload,
  ): Promise<{ application: ContractDocument }> {
    return apiFetch(`/api/orgs/${orgId}/applications`, { method: 'POST', body });
  },
  mine(): Promise<{ applications: ApplicationItem[] }> {
    return apiFetch('/api/applications/mine');
  },
  orgList(orgId: string): Promise<{ applications: OrgApplicationItem[] }> {
    return apiFetch(`/api/orgs/${orgId}/applications`);
  },
  accept(id: string): Promise<{ application: ContractDocument }> {
    return apiFetch(`/api/applications/${id}/accept`, { method: 'POST' });
  },
  reject(id: string): Promise<{ application: ContractDocument }> {
    return apiFetch(`/api/applications/${id}/reject`, { method: 'POST' });
  },
  cancel(id: string): Promise<{ application: ContractDocument }> {
    return apiFetch(`/api/applications/${id}/cancel`, { method: 'POST' });
  },
};

/** Договоры об увольнении (SPEC v2 §12, documents.type='dismissal'). */
export const dismissalsApi = {
  create(
    orgId: string,
    body: { userId: string; reason?: string },
  ): Promise<{ document: ContractDocument }> {
    return apiFetch(`/api/orgs/${orgId}/dismissals`, { method: 'POST', body });
  },
  mine(): Promise<{ documents: DocumentItem[] }> {
    return apiFetch('/api/documents/mine');
  },
  orgList(orgId: string): Promise<{ documents: OrgDismissalItem[] }> {
    return apiFetch(`/api/orgs/${orgId}/dismissals`);
  },
  sign(
    id: string,
    body: ContractSignaturePayload,
  ): Promise<{ document: ContractDocument }> {
    return apiFetch(`/api/documents/${id}/sign`, { method: 'POST', body });
  },
  reject(id: string): Promise<{ document: ContractDocument }> {
    return apiFetch(`/api/documents/${id}/reject`, { method: 'POST' });
  },
  cancel(id: string): Promise<{ document: ContractDocument }> {
    return apiFetch(`/api/documents/${id}/cancel`, { method: 'POST' });
  },
  terminate(id: string): Promise<{ document: ContractDocument }> {
    return apiFetch(`/api/documents/${id}/terminate`, { method: 'POST' });
  },
};

export const invitesApi = {
  /** Caller's incoming pending invites. */
  mine(): Promise<{ invites: IncomingInvite[] }> {
    return apiFetch('/api/invites');
  },
  accept(id: string, body: ContractSignaturePayload): Promise<{ org: Org; role: Role }> {
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
  /** Отметить канал прочитанным (SPEC v3 §18, клиент шлёт ≤ 1 раза / 3 с). */
  markRead(id: string, at?: number): Promise<{ ok: true }> {
    return apiFetch(`/api/channels/${id}/read`, {
      method: 'POST',
      body: at !== undefined ? { at } : {},
    });
  },
  /** Кто и когда прочитал канал (SPEC v3 §18). */
  readStatus(id: string): Promise<{ reads: ReadEntry[] }> {
    return apiFetch(`/api/channels/${id}/read-status`);
  },
};
