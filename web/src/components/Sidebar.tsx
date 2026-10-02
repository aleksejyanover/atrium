import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { canCreateChannel } from '../permissions';
import { roleLabel, roleRank, formatRub } from '../types';
import { Avatar } from './Avatar';
import { CreateOrgModal } from './CreateOrgModal';
import { CreateChannelModal } from './CreateChannelModal';
import {
  ClipboardIcon,
  ChevronDownIcon,
  CheckIcon,
  DashboardIcon,
  FileTextIcon,
  GlobeIcon,
  HashIcon,
  LogOutIcon,
  MailIcon,
  PlusIcon,
  WalletIcon,
} from './icons';

interface SidebarProps {
  open: boolean;
  onNavigate: () => void;
}

export function Sidebar({ open, onNavigate }: SidebarProps) {
  const {
    user,
    orgs,
    currentOrgId,
    detail,
    dms,
    dmsLoaded,
    invites,
    online,
    view,
    selectedChannelId,
    myApplications,
    incomingApplications,
    myDocuments,
    selectOrg,
    selectChannel,
    setView,
    logout,
  } = useApp();

  const [orgMenu, setOrgMenu] = useState(false);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const currentOrg = orgs.find((o) => o.id === currentOrgId) ?? null;
  const rank = detail ? roleRank(detail.role) : 0;
  const orgDMs = dms.filter((d) => (detail ? d.org === null || d.org.id === detail.org.id : d.org === null));

  const pendingIncoming = incomingApplications.filter((a) => a.application.status === 'pending').length;
  const pendingMine = myApplications.filter((a) => a.application.status === 'pending').length;
  const appsBadge = pendingIncoming + pendingMine;
  const docsBadge = myDocuments.filter((d) => d.document.status === 'pending').length;

  // SPEC v6 §32: баланс — обычное число у всех (и у владельца)
  const balanceBadge =
    user && typeof user.balance === 'number' ? formatRub(user.balance) : null;

  useEffect(() => {
    if (!orgMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOrgMenu(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [orgMenu]);

  const pickOrg = (id: string) => {
    selectOrg(id);
    setOrgMenu(false);
    onNavigate();
  };

  const openChannel = (id: string) => {
    selectChannel(id);
    onNavigate();
  };

  const go = (v: 'catalog' | 'applications' | 'documents' | 'invites' | 'profile' | 'wallet' | 'admin') => {
    setView(v);
    onNavigate();
  };

  return (
    <aside className={open ? 'sidebar open' : 'sidebar'}>
      {/* org switcher */}
      <div className="side-top" ref={menuRef}>
        <button
          className={orgMenu ? 'org-switcher open' : 'org-switcher'}
          onClick={() => setOrgMenu((v) => !v)}
        >
          <Avatar
            name={currentOrg?.name ?? 'Atrium'}
            color={currentOrg ? '#6C5CE7' : '#2A2A33'}
            size={26}
          />
          <span className="org-name">{currentOrg?.name ?? 'Нет организаций'}</span>
          <ChevronDownIcon className="chev" size={15} />
        </button>

        {orgMenu && (
          <div className="dropdown">
            {orgs.map((o) => (
              <button
                key={o.id}
                className={o.id === currentOrgId ? 'dropdown-item active' : 'dropdown-item'}
                onClick={() => pickOrg(o.id)}
              >
                <span className="grow">{o.name}</span>
                <span className={`role-badge ${o.role}`}>{roleLabel(o.role)}</span>
                {o.id === currentOrgId && <CheckIcon size={14} />}
              </button>
            ))}
            {orgs.length === 0 && <div className="empty-state">Нет организаций</div>}
            <div className="dropdown-sep" />
            <button
              className="dropdown-item accent"
              onClick={() => {
                setOrgMenu(false);
                setShowCreateOrg(true);
              }}
            >
              <PlusIcon size={15} />
              <span className="grow">Создать организацию</span>
            </button>
          </div>
        )}
      </div>

      <div className="side-scroll">
        {/* catalog (SPEC v2 §14.1) */}
        <div className="side-section">
          <button
            className={view === 'catalog' ? 'side-item active' : 'side-item'}
            onClick={() => go('catalog')}
          >
            <GlobeIcon size={15} />
            <span className="grow">Каталог организаций</span>
          </button>
          <button
            className={view === 'wallet' ? 'side-item active' : 'side-item'}
            onClick={() => go('wallet')}
          >
            <WalletIcon size={15} />
            <span className="grow">Кошелёк</span>
            {balanceBadge !== null && (
              <span className="badge balance-badge">{balanceBadge}</span>
            )}
          </button>
        </div>

        {/* channels */}
        <div className="side-section">
          <div className="side-section-head">
            <span className="side-section-title">Каналы</span>
            {canCreateChannel(rank) && (
              <button
                className="icon-btn"
                style={{ width: 24, height: 24 }}
                title="Создать канал"
                onClick={() => setShowCreateChannel(true)}
              >
                <PlusIcon size={14} />
              </button>
            )}
          </div>
          {detail && detail.channels.length === 0 && (
            <div className="empty-state">Нет каналов</div>
          )}
          {detail?.channels.map((c) => (
            <button
              key={c.id}
              className={
                view === 'chat' && selectedChannelId === c.id
                  ? 'side-item active'
                  : 'side-item'
              }
              onClick={() => openChannel(c.id)}
            >
              <HashIcon className="hash" size={15} />
              <span className="grow">{c.name}</span>
              {!!c.unread && c.unread > 0 && <span className="badge">{c.unread}</span>}
            </button>
          ))}
        </div>

        {/* direct messages */}
        <div className="side-section">
          <div className="side-section-head">
            <span className="side-section-title">Прямые сообщения</span>
          </div>
          {dmsLoaded && orgDMs.length === 0 && (
            <div className="empty-state">Нет диалогов — откройте участника в списке справа</div>
          )}
          {orgDMs.map((d) => (
            <button
              key={d.channel.id}
              className={
                view === 'chat' && selectedChannelId === d.channel.id
                  ? 'side-item active'
                  : 'side-item'
              }
              onClick={() => openChannel(d.channel.id)}
            >
              <Avatar
                name={d.peer.displayName}
                color={d.peer.avatarColor}
                size={22}
                showDot
                online={online.has(d.peer.id)}
              />
              <span className="grow">{d.peer.displayName}</span>
              {!!d.channel.unread && d.channel.unread > 0 && (
                <span className="badge">{d.channel.unread}</span>
              )}
            </button>
          ))}
        </div>

        {/* applications / documents / invites (SPEC v2 §14.3–14.4) */}
        <div className="side-section">
          <button
            className={view === 'applications' ? 'side-item active' : 'side-item'}
            onClick={() => go('applications')}
          >
            <ClipboardIcon size={15} />
            <span className="grow">Заявления</span>
            {appsBadge > 0 && <span className="badge">{appsBadge}</span>}
          </button>
          <button
            className={view === 'documents' ? 'side-item active' : 'side-item'}
            onClick={() => go('documents')}
          >
            <FileTextIcon size={15} />
            <span className="grow">Документы</span>
            {docsBadge > 0 && <span className="badge danger-badge">{docsBadge}</span>}
          </button>
          <button
            className={view === 'invites' ? 'side-item active' : 'side-item'}
            onClick={() => go('invites')}
          >
            <MailIcon size={15} />
            <span className="grow">Входящие приглашения</span>
            {invites.length > 0 && <span className="badge">{invites.length}</span>}
          </button>
        </div>
      </div>

      {/* superadmin panel (SPEC v4 §25) — rendered only for creators */}
      {user?.isAdmin && (
        <div className="side-section side-admin">
          <button
            className={view === 'admin' ? 'side-item active' : 'side-item accent-item'}
            onClick={() => go('admin')}
          >
            <DashboardIcon size={15} />
            <span className="grow">Панель создателя</span>
          </button>
        </div>
      )}

      {/* profile */}
      <div className="side-profile">
        <button
          className={view === 'profile' ? 'profile-btn active' : 'profile-btn'}
          onClick={() => go('profile')}
          title="Профиль"
        >
          <Avatar name={user?.displayName ?? '?'} color={user?.avatarColor ?? '#7C6CF6'} size={34} />
          <div className="who">
            <div className="nm">{user?.displayName ?? ''}</div>
            <div className="un">@{user?.username ?? ''}</div>
          </div>
        </button>
        <button className="icon-btn danger" title="Выйти" onClick={logout}>
          <LogOutIcon size={16} />
        </button>
      </div>

      {showCreateOrg && <CreateOrgModal onClose={() => setShowCreateOrg(false)} />}
      {showCreateChannel && <CreateChannelModal onClose={() => setShowCreateChannel(false)} />}
    </aside>
  );
}
