import type {
  ActivityEntry,
  CallKind,
  Channel,
  ContractDocument,
  Invite,
  Message,
  Role,
  User,
} from '@/lib/types';

/** The server may deliver a user either directly or wrapped as `{ user }`. */
export interface MaybeWrappedUser {
  user?: User;
  id?: string;
  username?: string;
  displayName?: string;
  avatarColor?: string;
}

export function unwrapUser(
  value: MaybeWrappedUser | User | string | null | undefined,
): User | null {
  if (!value || typeof value === 'string') return null;
  const candidate = value as MaybeWrappedUser;
  if (candidate.user) return candidate.user;
  if (candidate.id && candidate.username) return value as User;
  return null;
}

export function unwrapUserId(
  value: MaybeWrappedUser | User | string | null | undefined,
): string | null {
  if (!value || typeof value === 'string') return value || null;
  const candidate = value as MaybeWrappedUser;
  if (candidate.user?.id) return candidate.user.id;
  if (candidate.id) return candidate.id;
  return null;
}

export interface SessionDescriptionPayload {
  type: string | null;
  sdp: string;
}

export interface IceCandidatePayload {
  candidate?: string | null;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  [key: string]: unknown;
}

export interface AckResult {
  ok?: boolean;
  error?: string;
}

export interface ServerToClientEvents {
  'message:new': (payload: { message: Message }) => void;
  /** Сообщение удалено (автором, другим участником или модератором, SPEC v9 §37). */
  'message:deleted': (payload: { messageId: string; channelId: string }) => void;
  typing: (payload: { channelId: string; user: User; typing: boolean }) => void;
  'invite:new': (payload: {
    invite: Invite;
    org: { id: string; name: string };
    inviter: MaybeWrappedUser | User;
  }) => void;
  'member:joined': (payload: { orgId: string; user: User; role: Role }) => void;
  'member:left': (payload: { orgId: string; userId: string }) => void;
  'role:changed': (payload: { orgId: string; userId: string; role: Role }) => void;
  'channel:created': (payload: { orgId: string; channel: Channel }) => void;
  /** Кто-то прочитал канал (SPEC v3 §18). */
  'channel:read': (payload: { channelId: string; userId: string; lastReadAt: number }) => void;
  /** Новое заявление — staff орг. (rank ≥ 40, SPEC v2 §13). */
  'application:new': (payload: {
    application: ContractDocument;
    org: { id: string; name: string };
    user: User;
  }) => void;
  /** Заявление принято/отклонено/отозвано (SPEC v2 §13). */
  'application:update': (payload: {
    application: ContractDocument;
    org?: { id: string; name: string };
  }) => void;
  /** Прислан договор об увольнении — target_user_id (SPEC v2 §13). */
  'document:new': (payload: { document: ContractDocument; org: { id: string; name: string } }) => void;
  /** Статус договора об увольнении изменился (SPEC v2 §13). */
  'document:update': (payload: {
    document: ContractDocument;
    org?: { id: string; name: string };
  }) => void;
  /** Новая запись истории действий (SPEC v3 §18). */
  'activity:new': (payload: { activity: ActivityEntry }) => void;
  /** Баланс кошелька изменился — только владельцу счёта (SPEC v4 §24, v6 §32 — число). */
  'wallet:updated': (payload: {
    balance: number;
    reason?:
      | 'topup'
      | 'transfer'
      | 'salary'
      | 'treasury_deposit'
      | 'bank_withdraw'
      | 'bank_topup';
    from?: User;
    amount?: number;
  }) => void;
  'call:incoming': (payload: {
    callId: string;
    from: MaybeWrappedUser | User;
    kind: CallKind;
    channelId?: string;
  }) => void;
  'call:accepted': (payload: { callId: string }) => void;
  'call:rejected': (payload: { callId: string }) => void;
  'call:left': (payload: { callId: string }) => void;
  'call:state': (payload: { callId: string; muted: boolean; cameraOff: boolean }) => void;
  'rtc:sdp': (payload: {
    callId: string;
    from: MaybeWrappedUser | User | string;
    sdp: SessionDescriptionPayload;
  }) => void;
  'rtc:ice': (payload: {
    callId: string;
    from: MaybeWrappedUser | User | string;
    candidate: IceCandidatePayload;
  }) => void;
  'presence:update': (payload: { userId: string; online: boolean }) => void;
  /** Снапшот всех сейчас онлайн при каждом подключении сокета (SPEC v8 §34). */
  'presence:list': (payload: { userIds: string[] }) => void;
  /** Вы заблокированы администратором: блокирующее окно + выход (SPEC v8 §35). */
  'user:banned': (payload: { byName: string; reason: string }) => void;
}

export interface ClientToServerEvents {
  'message:send': (
    payload: { channelId: string; text: string; tempId?: string },
    ack: (res: AckResult & { message?: Message; moderated?: boolean }) => void,
  ) => void;
  typing: (payload: { channelId: string; typing: boolean }, ack?: (res: AckResult) => void) => void;
  'call:invite': (
    payload: { calleeId: string; kind: CallKind; channelId?: string },
    ack: (res: AckResult & { callId?: string }) => void,
  ) => void;
  'call:accept': (payload: { callId: string }, ack: (res: AckResult) => void) => void;
  'call:reject': (payload: { callId: string }, ack: (res: AckResult) => void) => void;
  'call:leave': (payload: { callId: string }, ack: (res: AckResult) => void) => void;
  'call:state': (
    payload: { callId: string; muted: boolean; cameraOff: boolean },
    ack: (res: AckResult) => void,
  ) => void;
  'rtc:sdp': (
    payload: { callId: string; to: string; sdp: SessionDescriptionPayload },
    ack: (res: AckResult) => void,
  ) => void;
  'rtc:ice': (
    payload: { callId: string; to: string; candidate: IceCandidatePayload },
    ack: (res: AckResult) => void,
  ) => void;
}

export type AppSocket = import('socket.io-client').Socket<
  ServerToClientEvents,
  ClientToServerEvents
>;
