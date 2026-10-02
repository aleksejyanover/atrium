import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Socket } from 'socket.io-client';
import { api, ApiError, clearToken, getToken } from './api';
import { connectSocket, disconnectSocket } from './socket';
import {
  roleRank,
  formatRub,
  unwrapUser,
  type Channel,
  type DMEntry,
  type IncomingApplication,
  type IncomingInvite,
  type MyApplication,
  type MyDocument,
  type OrgDetail,
  type OrgWithRole,
  type User,
} from './types';
import { isRecord } from './types';
import type { ToastItem } from './components/Toasts';

const LAST_ORG_KEY = 'atrium_last_org';
const APP_TITLE = 'Atrium — корпоративный мессенджер';

export type View =
  | 'chat'
  | 'invites'
  | 'catalog'
  | 'applications'
  | 'documents'
  | 'profile'
  | 'wallet'
  | 'admin';

export type PanelTab = 'members' | 'invites' | 'activity' | 'roles' | 'info' | 'finance';

export interface AppStore {
  booted: boolean;
  bootError: string | null;
  user: User | null;
  socket: Socket | null;

  orgs: OrgWithRole[];
  currentOrgId: string | null;
  detail: OrgDetail | null;
  dms: DMEntry[];
  dmsLoaded: boolean;
  invites: IncomingInvite[];
  online: Set<string>;

  /* SPEC v2 §14.3–14.4 — applications & dismissal documents */
  myApplications: MyApplication[];
  incomingApplications: IncomingApplication[];
  myDocuments: MyDocument[];

  view: View;
  selectedChannelId: string | null;
  panelOpen: boolean;
  panelTab: PanelTab;

  toasts: ToastItem[];

  selectOrg: (id: string) => void;
  selectChannel: (id: string) => void;
  setView: (v: View) => void;
  openPanel: (tab?: PanelTab) => void;
  closePanel: () => void;
  setPanelTab: (tab: PanelTab) => void;

  refreshOrgs: () => Promise<void>;
  refreshDetail: () => Promise<void>;
  refreshDMs: () => Promise<void>;
  refreshInvites: () => Promise<void>;
  refreshMyApplications: () => Promise<void>;
  refreshIncomingApplications: () => Promise<void>;
  refreshApplications: () => Promise<void>;
  refreshMyDocuments: () => Promise<void>;

  /** Read/unread bookkeeping (SPEC v3 §18). */
  setChannelUnread: (channelId: string, value: number) => void;

  /** Replace the cached profile after PATCH /api/me. */
  updateUser: (user: User) => void;

  /** Re-read `GET /api/me` (после активации карточки владельца, SPEC v5 §29). */
  refreshUser: () => Promise<void>;

  startDM: (userId: string) => Promise<void>;
  addChannel: (channel: Channel) => void;
  toast: (text: string, kind?: ToastItem['kind']) => void;
  logout: () => void;
}

const StoreContext = createContext<AppStore | null>(null);

export function useApp(): AppStore {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [booted, setBooted] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  const [orgs, setOrgs] = useState<OrgWithRole[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(() =>
    localStorage.getItem(LAST_ORG_KEY),
  );
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [dms, setDms] = useState<DMEntry[]>([]);
  const [dmsLoaded, setDmsLoaded] = useState(false);
  const [invites, setInvites] = useState<IncomingInvite[]>([]);
  const [online, setOnline] = useState<Set<string>>(() => new Set());

  const [myApplications, setMyApplications] = useState<MyApplication[]>([]);
  const [incomingApplications, setIncomingApplications] = useState<IncomingApplication[]>([]);
  const [myDocuments, setMyDocuments] = useState<MyDocument[]>([]);

  const [view, setView] = useState<View>('chat');
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('members');

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const currentOrgIdRef = useRef(currentOrgId);
  currentOrgIdRef.current = currentOrgId;
  const orgsRef = useRef(orgs);
  orgsRef.current = orgs;
  const userRef = useRef(user);
  userRef.current = user;
  const toastSeq = useRef(0);
  const detailSeq = useRef(0);

  const toast = useCallback((text: string, kind: ToastItem['kind'] = 'info') => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-3), { id, text, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    disconnectSocket();
    localStorage.removeItem(LAST_ORG_KEY);
    window.location.assign('/login');
  }, []);

  /* ---------------- data loaders ---------------- */

  const refreshOrgs = useCallback(async () => {
    try {
      const list = await api.listOrgs();
      setOrgs(list);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast(e instanceof Error ? e.message : 'Не удалось загрузить организации', 'error');
    }
  }, [toast]);

  const refreshDetail = useCallback(async () => {
    const id = currentOrgIdRef.current;
    if (!id) {
      setDetail(null);
      return;
    }
    const seq = ++detailSeq.current;
    try {
      const d = await api.getOrg(id);
      if (seq === detailSeq.current) setDetail(d);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        // org no longer accessible → reload the list and re-pick
        if (seq === detailSeq.current) setDetail(null);
        await refreshOrgs();
        return;
      }
      if (!(e instanceof ApiError && e.status === 401)) {
        toast(e instanceof Error ? e.message : 'Не удалось загрузить организацию', 'error');
      }
    }
  }, [refreshOrgs, toast]);

  const refreshDMs = useCallback(async () => {
    try {
      const list = await api.listDMs();
      setDms(list);
      setDmsLoaded(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      setDmsLoaded(true);
    }
  }, []);

  const refreshInvites = useCallback(async () => {
    try {
      const list = await api.listIncomingInvites();
      setInvites(list);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast(e instanceof Error ? e.message : 'Не удалось загрузить приглашения', 'error');
    }
  }, [toast]);

  const refreshMyApplications = useCallback(async () => {
    try {
      const list = await api.myApplications();
      setMyApplications(list);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast(e instanceof Error ? e.message : 'Не удалось загрузить заявления', 'error');
    }
  }, [toast]);

  /** Incoming applications for every org where I'm staff (rank ≥ 40). */
  const refreshIncomingApplications = useCallback(async () => {
    const staff = orgsRef.current.filter((o) => roleRank(o.role) >= 40);
    if (staff.length === 0) {
      setIncomingApplications([]);
      return;
    }
    const lists = await Promise.all(staff.map((o) => api.orgApplications(o.id).catch(() => null)));
    const merged: IncomingApplication[] = [];
    lists.forEach((items, i) => {
      if (!items) return;
      const org = { id: staff[i].id, name: staff[i].name };
      items.forEach((it) => merged.push({ ...it, org }));
    });
    merged.sort((a, b) => b.application.createdAt - a.application.createdAt);
    setIncomingApplications(merged);
  }, []);

  const refreshApplications = useCallback(async () => {
    await Promise.all([refreshMyApplications(), refreshIncomingApplications()]);
  }, [refreshIncomingApplications, refreshMyApplications]);

  const refreshMyDocuments = useCallback(async () => {
    try {
      const list = await api.myDocuments();
      setMyDocuments(list);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast(e instanceof Error ? e.message : 'Не удалось загрузить документы', 'error');
    }
  }, [toast]);

  /* ---------------- unread bookkeeping (SPEC v3 §18) ---------------- */

  const setChannelUnread = useCallback((channelId: string, value: number) => {
    const v = Math.max(0, value);
    setDms((prev) => {
      if (!prev.some((d) => d.channel.id === channelId)) return prev;
      return prev.map((d) =>
        d.channel.id === channelId ? { ...d, channel: { ...d.channel, unread: v } } : d,
      );
    });
    setDetail((prev) => {
      if (!prev) return prev;
      const idx = prev.channels.findIndex((c) => c.id === channelId);
      if (idx < 0) return prev;
      const channels = [...prev.channels];
      channels[idx] = { ...channels[idx], unread: v };
      return { ...prev, channels };
    });
  }, []);

  const bumpUnread = useCallback((channelId: string) => {
    setDms((prev) =>
      prev.map((d) =>
        d.channel.id === channelId
          ? { ...d, channel: { ...d.channel, unread: (d.channel.unread ?? 0) + 1 } }
          : d,
      ),
    );
    setDetail((prev) => {
      if (!prev) return prev;
      const idx = prev.channels.findIndex((c) => c.id === channelId);
      if (idx < 0) return prev;
      const channels = [...prev.channels];
      channels[idx] = { ...channels[idx], unread: (channels[idx].unread ?? 0) + 1 };
      return { ...prev, channels };
    });
  }, []);

  const updateUser = useCallback((next: User) => {
    setUser(next);
  }, []);

  /** Свежая копия профиля: `GET /api/me` (isOwner, balance: null у владельца). */
  const refreshUser = useCallback(async () => {
    try {
      const { user: me } = await api.me();
      setUser(me);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return;
      toast(e instanceof Error ? e.message : 'Не удалось обновить профиль', 'error');
    }
  }, [toast]);

  /* ---------------- boot ---------------- */

  useEffect(() => {
    const token = getToken();
    if (!token) return; // route guard redirects to /login
    let cancelled = false;
    void (async () => {
      try {
        const { user: me } = await api.me();
        if (cancelled) return;
        setUser(me);
        setSocket(connectSocket(token));
        await refreshOrgs();
        await Promise.all([
          refreshInvites(),
          refreshDMs(),
          refreshMyApplications(),
          refreshMyDocuments(),
          refreshIncomingApplications(),
        ]);
        if (!cancelled) setBooted(true);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) return; // api already redirected
        setBootError(e instanceof Error ? e.message : 'Ошибка загрузки');
        setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- org selection ---------------- */

  // Keep the selection valid when the org list changes (first load, leave, accept).
  useEffect(() => {
    if (orgs.length === 0) {
      if (detail !== null) setDetail(null);
      return;
    }
    const stored = currentOrgId && orgs.some((o) => o.id === currentOrgId)
      ? currentOrgId
      : localStorage.getItem(LAST_ORG_KEY);
    const target =
      stored && orgs.some((o) => o.id === stored) ? stored : orgs[0]?.id ?? null;
    if (target && target !== currentOrgId) {
      setCurrentOrgId(target);
      localStorage.setItem(LAST_ORG_KEY, target);
    }
  }, [orgs, currentOrgId, detail]);

  // Membership changed → incoming applications may change too.
  useEffect(() => {
    if (!booted) return;
    void refreshIncomingApplications();
  }, [booted, orgs, refreshIncomingApplications]);

  // Load org detail (and refresh DMs, which are scoped per account) on org change.
  useEffect(() => {
    if (!currentOrgId) {
      setDetail(null);
      return;
    }
    void refreshDetail();
    void refreshDMs();
  }, [currentOrgId, refreshDetail, refreshDMs]);

  // Pick a channel when none is selected (or the selection became invalid).
  useEffect(() => {
    if (!detail) return;
    // org-less DMs (the bot chat, SPEC v4 §23) stay selectable too
    const selectedIsDm =
      dmsLoaded &&
      dms.some(
        (d) =>
          d.channel.id === selectedChannelId &&
          (d.org === null || d.org.id === detail.org.id),
      );
    const found =
      selectedChannelId !== null &&
      (detail.channels.some((c) => c.id === selectedChannelId) || selectedIsDm);
    if (found) return;
    if (selectedChannelId !== null && !dmsLoaded) return; // might be a DM still loading
    const firstDm =
      dms.find((d) => d.org !== null && d.org.id === detail.org.id)?.channel.id ?? null;
    setSelectedChannelId(detail.channels[0]?.id ?? firstDm);
  }, [detail, dms, dmsLoaded, selectedChannelId]);

  /* ---------------- document.title unread counter (SPEC v3 §18) ---------------- */

  useEffect(() => {
    const otherOrgsUnread = orgs
      .filter((o) => o.id !== currentOrgId)
      .reduce((sum, o) => sum + (o.unread ?? 0), 0);
    const currentOrgChannelsUnread = (detail?.channels ?? []).reduce(
      (sum, c) => sum + (c.unread ?? 0),
      0,
    );
    const dmUnread = dms.reduce((sum, d) => sum + (d.channel.unread ?? 0), 0);
    const total = otherOrgsUnread + currentOrgChannelsUnread + dmUnread;
    document.title = total > 0 ? `(${total}) ${APP_TITLE}` : APP_TITLE;
  }, [orgs, detail, dms, currentOrgId]);

  /* ---------------- socket events ---------------- */

  useEffect(() => {
    if (!socket) return;

    const orgNameOf = (payload: unknown): string =>
      isRecord(payload) && isRecord(payload.org) && typeof payload.org.name === 'string'
        ? payload.org.name
        : '';

    const onInviteNew = (payload: unknown) => {
      const orgName = orgNameOf(payload);
      toast(
        orgName ? `Вас пригласили в организацию «${orgName}»` : 'Вам поступило приглашение',
        'success',
      );
      void refreshInvites();
    };

    const onMemberEvent = (payload: unknown) => {
      if (!isRecord(payload)) return;
      if (payload.orgId === currentOrgIdRef.current) void refreshDetail();
    };

    const onChannelCreated = (payload: unknown) => {
      if (!isRecord(payload)) return;
      if (payload.orgId !== currentOrgIdRef.current) return;
      const channel = payload.channel;
      if (!isRecord(channel) || typeof channel.id !== 'string') return;
      setDetail((prev) => {
        if (!prev || prev.channels.some((c) => c.id === channel.id)) return prev;
        return { ...prev, channels: [...prev.channels, channel as unknown as Channel] };
      });
    };

    const onPresence = (payload: unknown) => {
      if (!isRecord(payload) || typeof payload.userId !== 'string') return;
      const id = payload.userId;
      const isOnline = payload.online === true;
      setOnline((prev) => {
        const has = prev.has(id);
        if (has === isOnline) return prev;
        const next = new Set(prev);
        if (isOnline) next.add(id);
        else next.delete(id);
        return next;
      });
    };

    /* ---- unread bump on incoming messages ---- */

    const onNewMessage = (payload: unknown) => {
      if (!isRecord(payload) || !isRecord(payload.message)) return;
      const m = payload.message;
      if (typeof m.channelId !== 'string') return;
      const senderId = isRecord(m.sender) && typeof m.sender.id === 'string' ? m.sender.id : null;
      if (senderId && senderId === userRef.current?.id) return; // own messages are read
      bumpUnread(m.channelId);
    };

    /* ---- SPEC v2 §13: applications & documents ---- */

    const docFrom = (payload: unknown): { id: string; status: string; target: string | null } | null => {
      if (!isRecord(payload)) return null;
      const d = isRecord(payload.document)
        ? payload.document
        : isRecord(payload.application)
          ? payload.application
          : null;
      if (!d || typeof d.id !== 'string') return null;
      return {
        id: d.id,
        status: typeof d.status === 'string' ? d.status : '',
        target:
          typeof d.targetUserId === 'string'
            ? d.targetUserId
            : typeof d.target_user_id === 'string'
              ? d.target_user_id
              : null,
      };
    };

    const onApplicationNew = (payload: unknown) => {
      if (!isRecord(payload)) return;
      const orgName = orgNameOf(payload);
      toast(
        orgName ? `Новое заявление в «${orgName}»` : 'Новое заявление',
        'info',
      );
      void refreshIncomingApplications();
    };

    const onApplicationUpdate = (payload: unknown) => {
      const d = docFrom(payload);
      if (d && d.target === userRef.current?.id) {
        const text =
          d.status === 'approved'
            ? 'Ваше заявление принято'
            : d.status === 'rejected'
              ? 'Ваше заявление отклонено'
              : 'Заявление отозвано';
        toast(text, d.status === 'approved' ? 'success' : 'info');
      }
      void refreshApplications();
    };

    const onDocumentNew = (payload: unknown) => {
      const d = docFrom(payload);
      if (d && d.target === userRef.current?.id) {
        toast('Вам отправлен договор об увольнении', 'info');
      }
      void refreshMyDocuments();
      void refreshDetail();
    };

    const onDocumentUpdate = (payload: unknown) => {
      const d = docFrom(payload);
      const mine = d !== null && d.target === userRef.current?.id;
      if (mine && d) {
        const text =
          d.status === 'signed'
            ? 'Договор об увольнении подписан'
            : d.status === 'rejected'
              ? 'Вы оспорили договор об увольнении'
              : d.status === 'terminated'
                ? 'Договор об увольнении расторгнут'
                : 'Увольнение отменено';
        toast(text, d.status === 'canceled' ? 'success' : 'info');
        if (d.status === 'signed' || d.status === 'terminated') {
          // membership is gone → reload orgs + current detail
          void refreshOrgs();
        }
      }
      void refreshMyDocuments();
      void refreshDetail();
    };

    /* ---- SPEC v4 §24/§25: wallet balance + payment toasts ---- */

    const onWalletUpdated = (payload: unknown) => {
      if (!isRecord(payload)) return;
      // SPEC v5 §29: у владельца сервер шлёт `balance: null` («∞»)
      const next = payload.balance;
      if (typeof next !== 'number' && next !== null) return;
      const me = userRef.current;
      if (!me) return;
      setUser({ ...me, balance: next });
      const amount = typeof payload.amount === 'number' ? payload.amount : null;
      const reason = typeof payload.reason === 'string' ? payload.reason : '';
      if (reason === 'salary' && amount !== null) {
        toast(`💸 Начислена зарплата: +${formatRub(amount)}`, 'success');
      } else if (reason === 'transfer') {
        const from = unwrapUser(payload.from);
        const sum = amount !== null ? formatRub(amount) : '';
        toast(
          from ? `💸 Перевод: +${sum} от ${from.displayName}` : '💸 Получен перевод',
          'success',
        );
      }
    };

    socket.on('invite:new', onInviteNew);
    socket.on('member:joined', onMemberEvent);
    socket.on('member:left', onMemberEvent);
    socket.on('role:changed', onMemberEvent);
    socket.on('channel:created', onChannelCreated);
    socket.on('presence:update', onPresence);
    socket.on('message:new', onNewMessage);
    socket.on('application:new', onApplicationNew);
    socket.on('application:update', onApplicationUpdate);
    socket.on('document:new', onDocumentNew);
    socket.on('document:update', onDocumentUpdate);
    socket.on('wallet:updated', onWalletUpdated);

    return () => {
      socket.off('invite:new', onInviteNew);
      socket.off('member:joined', onMemberEvent);
      socket.off('member:left', onMemberEvent);
      socket.off('role:changed', onMemberEvent);
      socket.off('channel:created', onChannelCreated);
      socket.off('presence:update', onPresence);
      socket.off('message:new', onNewMessage);
      socket.off('application:new', onApplicationNew);
      socket.off('application:update', onApplicationUpdate);
      socket.off('document:new', onDocumentNew);
      socket.off('document:update', onDocumentUpdate);
      socket.off('wallet:updated', onWalletUpdated);
    };
  }, [
    socket,
    bumpUnread,
    refreshApplications,
    refreshDetail,
    refreshInvites,
    refreshMyDocuments,
    refreshOrgs,
    refreshIncomingApplications,
    toast,
  ]);

  /* ---------------- actions ---------------- */

  const selectOrg = useCallback((id: string) => {
    setCurrentOrgId(id);
    localStorage.setItem(LAST_ORG_KEY, id);
    setSelectedChannelId(null);
    setView('chat');
  }, []);

  const selectChannel = useCallback((id: string) => {
    setSelectedChannelId(id);
    setView('chat');
  }, []);

  const openPanel = useCallback((tab?: PanelTab) => {
    setPanelOpen(true);
    if (tab) setPanelTab(tab);
  }, []);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  const startDM = useCallback(
    async (userId: string) => {
      const orgId = currentOrgIdRef.current;
      if (!orgId) return;
      try {
        const { channel, peer } = await api.createDM(orgId, userId);
        setDms((prev) => {
          if (prev.some((d) => d.channel.id === channel.id)) return prev;
          const org =
            prev.find((d) => d.org !== null && d.org.id === orgId)?.org ??
            { id: orgId, name: '' };
          return [...prev, { channel, peer, org }];
        });
        setDmsLoaded(true);
        setSelectedChannelId(channel.id);
        setView('chat');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Не удалось открыть диалог', 'error');
      }
    },
    [toast],
  );

  const addChannel = useCallback((channel: Channel) => {
    setDetail((prev) => {
      if (!prev || prev.channels.some((c) => c.id === channel.id)) return prev;
      return { ...prev, channels: [...prev.channels, channel] };
    });
  }, []);

  const value: AppStore = {
    booted,
    bootError,
    user,
    socket,
    orgs,
    currentOrgId,
    detail,
    dms,
    dmsLoaded,
    invites,
    online,
    myApplications,
    incomingApplications,
    myDocuments,
    view,
    selectedChannelId,
    panelOpen,
    panelTab,
    toasts,
    selectOrg,
    selectChannel,
    setView,
    openPanel,
    closePanel,
    setPanelTab,
    refreshOrgs,
    refreshDetail,
    refreshDMs,
    refreshInvites,
    refreshMyApplications,
    refreshIncomingApplications,
    refreshApplications,
    refreshMyDocuments,
    setChannelUnread,
    updateUser,
    refreshUser,
    startDM,
    addChannel,
    toast,
    logout,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
