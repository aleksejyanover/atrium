/** Shared types for the Atrium web client (mirrors SPEC contract). */

export interface User {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarColor: string;
  createdAt: number;
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
}

export interface OrgWithRole extends Org {
  role: Role;
  unread?: number;
}

export interface OrgMember {
  user: User;
  role: Role;
  joinedAt: number;
}

export interface OrgDetail {
  org: Org;
  role: Role;
  members: OrgMember[];
  channels: Channel[];
}

export interface Channel {
  id: string;
  orgId?: string;
  name: string | null;
  type: 'channel' | 'dm';
  createdAt: number;
}

export interface DMEntry {
  channel: Channel;
  peer: User;
  org: { id: string; name: string };
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
