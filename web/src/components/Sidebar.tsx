import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import { canCreateChannel } from '../permissions';
import { roleLabel, roleRank } from '../types';
import { Avatar } from './Avatar';
import { CreateOrgModal } from './CreateOrgModal';
import { CreateChannelModal } from './CreateChannelModal';
import {
  ChevronDownIcon,
  CheckIcon,
  HashIcon,
  LogOutIcon,
  MailIcon,
  PlusIcon,
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
  const orgDMs = detail ? dms.filter((d) => d.org.id === detail.org.id) : [];

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
            </button>
          ))}
        </div>

        {/* incoming invites */}
        <div className="side-section">
          <button
            className={view === 'invites' ? 'side-item active' : 'side-item'}
            onClick={() => {
              setView('invites');
              onNavigate();
            }}
          >
            <MailIcon size={15} />
            <span className="grow">Входящие приглашения</span>
            {invites.length > 0 && <span className="badge">{invites.length}</span>}
          </button>
        </div>
      </div>

      {/* profile */}
      <div className="side-profile">
        <Avatar name={user?.displayName ?? '?'} color={user?.avatarColor ?? '#7C6CF6'} size={34} />
        <div className="who">
          <div className="nm">{user?.displayName ?? ''}</div>
          <div className="un">@{user?.username ?? ''}</div>
        </div>
        <button className="icon-btn danger" title="Выйти" onClick={logout}>
          <LogOutIcon size={16} />
        </button>
      </div>

      {showCreateOrg && <CreateOrgModal onClose={() => setShowCreateOrg(false)} />}
      {showCreateChannel && <CreateChannelModal onClose={() => setShowCreateChannel(false)} />}
    </aside>
  );
}
