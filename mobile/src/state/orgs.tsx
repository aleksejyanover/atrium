import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { applicationsApi, dismissalsApi, invitesApi, orgsApi } from '@/lib/endpoints';
import { ApplicationItem, DocumentItem, IncomingInvite, OrgListItem } from '@/lib/types';

interface OrgsContextValue {
  orgs: OrgListItem[];
  invites: IncomingInvite[];
  /** Мои документы (договоры об увольнении), pending сверху. */
  documents: DocumentItem[];
  /** Мои заявления на вступление, pending сверху. */
  applications: ApplicationItem[];
  loading: boolean;
  refresh(): Promise<void>;
  /** Быстрое обновление только документов/заявлений (socket v2 события). */
  refreshMine(): Promise<void>;
  /** Сколько моих договоров ждут подписи. */
  pendingDocuments: number;
}

const OrgsContext = createContext<OrgsContextValue | null>(null);

/** Shared org + invite + document/application lists (org picker, badges, realtime). */
export function OrgsProvider({ children }: { children: React.ReactNode }) {
  const [orgs, setOrgs] = useState<OrgListItem[]>([]);
  const [invites, setInvites] = useState<IncomingInvite[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [applications, setApplications] = useState<ApplicationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshMine = useCallback(async () => {
    try {
      const [docsRes, appsRes] = await Promise.all([dismissalsApi.mine(), applicationsApi.mine()]);
      setDocuments(docsRes.documents ?? []);
      setApplications(appsRes.applications ?? []);
    } catch {
      // keep the previous list when the network is unavailable
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [orgsRes, invitesRes] = await Promise.all([orgsApi.list(), invitesApi.mine()]);
      setOrgs(orgsRes.orgs);
      setInvites(invitesRes.invites);
      await refreshMine();
    } catch {
      // keep the previous list when the network is unavailable
    } finally {
      setLoading(false);
    }
  }, [refreshMine]);

  const pendingDocuments = useMemo(
    () =>
      documents.filter(
        (item) => item.document.type === 'dismissal' && item.document.status === 'pending',
      ).length,
    [documents],
  );

  const value = useMemo(
    () => ({
      orgs,
      invites,
      documents,
      applications,
      loading,
      refresh,
      refreshMine,
      pendingDocuments,
    }),
    [orgs, invites, documents, applications, loading, refresh, refreshMine, pendingDocuments],
  );

  return <OrgsContext.Provider value={value}>{children}</OrgsContext.Provider>;
}

export function useOrgs(): OrgsContextValue {
  const ctx = useContext(OrgsContext);
  if (!ctx) throw new Error('useOrgs must be used inside OrgsProvider');
  return ctx;
}
