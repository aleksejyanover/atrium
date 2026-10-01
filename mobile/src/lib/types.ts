export type Role = 'owner' | 'assistant_owner' | 'admin' | 'assistant_admin' | 'member';

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  avatarColor: string;
  createdAt?: number;
}

export interface Org {
  id: string;
  name: string;
  description?: string | null;
  createdAt: number;
  membersCount: number;
  channelsCount: number;
}

export interface OrgListItem extends Org {
  role: Role;
  unread?: number;
}

export interface Member {
  user: User;
  role: Role;
  joinedAt: number;
}

export interface OrgDetail {
  org: Org;
  role: Role;
  members: Member[];
  channels: Channel[];
}

export type ChannelType = 'channel' | 'dm';

export interface Channel {
  id: string;
  orgId: string;
  name: string | null;
  type: ChannelType;
  createdAt: number;
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
  org: { id: string; name: string };
}

export interface Paged<T> {
  messages: T[];
  hasMore: boolean;
}

export type CallKind = 'video' | 'audio';

export type CallStatus = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';
