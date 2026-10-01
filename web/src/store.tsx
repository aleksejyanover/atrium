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
import type { Channel, DMEntry, IncomingInvite, OrgDetail, OrgWithRole, User } from './types';
import { isRecord } from './types';
import type { ToastItem } from './components/Toasts';

const LAST_ORG_KEY = 'atrium_last_org';

export type View = 'chat' | 'invites';
export type PanelTab = 'members' | 'invites' | 'info';

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

  const [view, setView] = useState<View>('chat');
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('members');

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const currentOrgIdRef = useRef(currentOrgId);
  currentOrgIdRef.current = currentOrgId;
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
        await Promise.all([refreshOrgs(), refreshInvites(), refreshDMs()]);
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
    const inOrgDms =
      dmsLoaded && dms.some((d) => d.channel.id === selectedChannelId && d.org.id === detail.org.id);
    const found =
      selectedChannelId !== null &&
      (detail.channels.some((c) => c.id === selectedChannelId) || inOrgDms);
    if (found) return;
    if (selectedChannelId !== null && !dmsLoaded) return; // might be a DM still loading
    const firstDm = dms.find((d) => d.org.id === detail.org.id)?.channel.id ?? null;
    setSelectedChannelId(detail.channels[0]?.id ?? firstDm);
  }, [detail, dms, dmsLoaded, selectedChannelId]);

  /* ---------------- socket events (org scope) ---------------- */

  useEffect(() => {
    if (!socket) return;

    const onInviteNew = (payload: unknown) => {
      const orgName =
        isRecord(payload) && isRecord(payload.org) && typeof payload.org.name === 'string'
          ? payload.org.name
          : '';
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

    socket.on('invite:new', onInviteNew);
    socket.on('member:joined', onMemberEvent);
    socket.on('member:left', onMemberEvent);
    socket.on('role:changed', onMemberEvent);
    socket.on('channel:created', onChannelCreated);
    socket.on('presence:update', onPresence);

    return () => {
      socket.off('invite:new', onInviteNew);
      socket.off('member:joined', onMemberEvent);
      socket.off('member:left', onMemberEvent);
      socket.off('role:changed', onMemberEvent);
      socket.off('channel:created', onChannelCreated);
      socket.off('presence:update', onPresence);
    };
  }, [socket, refreshDetail, refreshInvites, toast]);

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
          const org = prev.find((d) => d.org.id === orgId)?.org ?? { id: orgId, name: '' };
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
    startDM,
    addChannel,
    toast,
    logout,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
