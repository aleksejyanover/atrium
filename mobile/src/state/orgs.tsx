import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { invitesApi, orgsApi } from '@/lib/endpoints';
import { IncomingInvite, OrgListItem } from '@/lib/types';

interface OrgsContextValue {
  orgs: OrgListItem[];
  invites: IncomingInvite[];
  loading: boolean;
  refresh(): Promise<void>;
}

const OrgsContext = createContext<OrgsContextValue | null>(null);

/** Shared org + incoming-invite list (used by the org picker and contract signing). */
export function OrgsProvider({ children }: { children: React.ReactNode }) {
  const [orgs, setOrgs] = useState<OrgListItem[]>([]);
  const [invites, setInvites] = useState<IncomingInvite[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [orgsRes, invitesRes] = await Promise.all([orgsApi.list(), invitesApi.mine()]);
      setOrgs(orgsRes.orgs);
      setInvites(invitesRes.invites);
    } catch {
      // keep the previous list when the network is unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  const value = useMemo(
    () => ({ orgs, invites, loading, refresh }),
    [orgs, invites, loading, refresh],
  );

  return <OrgsContext.Provider value={value}>{children}</OrgsContext.Provider>;
}

export function useOrgs(): OrgsContextValue {
  const ctx = useContext(OrgsContext);
  if (!ctx) throw new Error('useOrgs must be used inside OrgsProvider');
  return ctx;
}
