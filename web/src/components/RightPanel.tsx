import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import {
  canCancelInvite,
  canCreateChannel,
  canEditOrg,
  canInvite,
  canLeaveOrg,
  canRemoveMember,
  canViewOrgInvites,
  assignableRoles,
} from '../permissions';
import {
  ALL_ROLES,
  roleLabel,
  roleRank,
  type OrgMember,
  type PendingInvite,
  type Role,
  type User,
} from '../types';
import { Avatar } from './Avatar';
import { ConfirmModal, Modal } from './Modal';
import {
  DoorOpenIcon,
  InfoIcon,
  MailIcon,
  MessageIcon,
  MoreIcon,
  PencilIcon,
  TrashIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from './icons';

const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });

/* ============================================================
   Edit org (rank ≥ 60)
   ============================================================ */

function EditOrgModal({ onClose }: { onClose: () => void }) {
  const { detail, refreshDetail, refreshOrgs, toast } = useApp();
  const [name, setName] = useState(detail?.org.name ?? '');
  const [description, setDescription] = useState(detail?.org.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!detail) return null;

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Введите название организации (минимум 2 символа)');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.patchOrg(detail.org.id, {
        name: trimmed,
        description: description.trim(),
      });
      await Promise.all([refreshDetail(), refreshOrgs()]);
      toast('Организация обновлена', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Редактировать организацию"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Название</label>
        <input
          className="input"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="field">
        <label>Описание</label>
        <textarea
          className="textarea"
          value={description}
          maxLength={400}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Расскажите об организации"
        />
      </div>
    </Modal>
  );
}

/* ============================================================
   Invite a participant (rank ≥ 40)
   ============================================================ */

function InviteUserModal({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: () => void;
}) {
  const { currentOrgId, detail, toast } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [picked, setPicked] = useState<User | null>(null);
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rank = detail ? roleRank(detail.role) : 0;
  const inviteableRoles = ALL_ROLES.filter((r) => roleRank(r) < rank);

  useEffect(() => {
    if (picked) return;
    const query = q.trim();
    if (query.length < 1) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api
        .searchUsers(query)
        .then(setResults)
        .catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, picked]);

  const submit = async () => {
    if (!picked || !currentOrgId) return;
    setBusy(true);
    setError(null);
    try {
      await api.invite(currentOrgId, picked.username, role);
      toast(`Приглашение отправлено пользователю @${picked.username}`, 'success');
      onInvited();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить приглашение');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Пригласить участника"
      subtitle="Пользователь подпишет договор о присоединении"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn-primary"
            disabled={!picked || busy}
            onClick={() => void submit()}
          >
            {busy ? 'Отправка…' : 'Отправить приглашение'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label>Пользователь (имя или почта)</label>
        <input
          className="input"
          value={picked ? `@${picked.username}` : q}
          disabled={picked !== null}
          onChange={(e) => {
            setQ(e.target.value);
            setPicked(null);
          }}
          placeholder="Начните вводить имя…"
          autoFocus
        />
        {!picked && results.length > 0 && (
          <div className="search-results">
            {results.map((u) => (
              <button key={u.id} className="search-result" onClick={() => setPicked(u)}>
                <Avatar name={u.displayName} color={u.avatarColor} size={26} />
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  {u.displayName} <span className="muted">@{u.username}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {!picked && q.trim().length > 0 && results.length === 0 && (
          <div className="hint">Ничего не найдено</div>
        )}
      </div>
      <div className="field">
        <label>Роль в организации</label>
        <select className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {inviteableRoles.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}

/* ============================================================
   Right panel
   ============================================================ */

export function RightPanel() {
  const {
    user,
    detail,
    currentOrgId,
    panelTab,
    setPanelTab,
    closePanel,
    online,
    startDM,
    refreshDetail,
    refreshOrgs,
    refreshInvites,
    setView,
    toast,
  } = useApp();

  const [roleMenu, setRoleMenu] = useState<string | null>(null);
  const [showEditOrg, setShowEditOrg] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PendingInvite | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [pending, setPending] = useState<PendingInvite[] | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const actor = { id: user?.id ?? '', role: detail?.role ?? ('member' as Role) };
  const rank = roleRank(actor.role);

  useEffect(() => {
    if (!roleMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setRoleMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [roleMenu]);

  // Load outgoing pending invites when the tab is opened.
  const loadPending = async () => {
    if (!currentOrgId) return;
    try {
      const list = await api.listOrgInvites(currentOrgId);
      setPending(list);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось загрузить приглашения', 'error');
      setPending([]);
    }
  };

  useEffect(() => {
    if (panelTab !== 'invites') return;
    if (!canViewOrgInvites(rank)) return;
    setPending(null);
    void loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelTab, currentOrgId, rank]);

  if (!detail) return null;

  const tabs: Array<{ id: 'members' | 'invites' | 'info'; label: string; icon: ReactNode }> = [
    { id: 'members', label: 'Участники', icon: <UsersIcon size={13} /> },
    ...(canViewOrgInvites(rank)
      ? [{ id: 'invites' as const, label: 'Приглашения', icon: <MailIcon size={13} /> }]
      : []),
    { id: 'info', label: 'Информация', icon: <InfoIcon size={13} /> },
  ];

  const changeRole = async (member: OrgMember, role: Role) => {
    setRoleMenu(null);
    if (!currentOrgId) return;
    try {
      await api.setMemberRole(currentOrgId, member.user.id, role);
      toast(`Роль изменена: ${member.user.displayName} → ${roleLabel(role)}`, 'success');
      await refreshDetail();
      void refreshOrgs();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось изменить роль', 'error');
    }
  };

  const removeMember = async () => {
    if (!removeTarget || !currentOrgId) return;
    try {
      await api.removeMember(currentOrgId, removeTarget.user.id);
      toast(`${removeTarget.user.displayName} исключён(а) из организации`, 'success');
      setRemoveTarget(null);
      await refreshDetail();
      void refreshOrgs();
    } catch (e) {
      setRemoveTarget(null);
      toast(e instanceof Error ? e.message : 'Не удалось исключить участника', 'error');
    }
  };

  const cancelInvite = async () => {
    if (!cancelTarget) return;
    try {
      await api.cancelInvite(cancelTarget.id);
      toast('Приглашение отменено', 'success');
      setCancelTarget(null);
      await loadPending();
    } catch (e) {
      setCancelTarget(null);
      toast(e instanceof Error ? e.message : 'Не удалось отменить приглашение', 'error');
    }
  };

  const leaveOrg = async () => {
    if (!currentOrgId) return;
    try {
      await api.leaveOrg(currentOrgId);
      const orgName = detail.org.name;
      setLeaveConfirm(false);
      closePanel();
      setView('chat');
      await refreshOrgs();
      await refreshInvites();
      toast(`Вы покинули организацию «${orgName}»`, 'success');
      // the org-selection effect re-picks the next org (or shows an empty state)
    } catch (e) {
      setLeaveConfirm(false);
      toast(e instanceof Error ? e.message : 'Не удалось покинуть организацию', 'error');
    }
  };

  /* ---------------- tabs: members ---------------- */

  const renderMembers = () => (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <p className="panel-section-title" style={{ margin: 0 }}>
          Участники — {detail.members.length}
        </p>
        {canInvite(rank) && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowInvite(true)}>
            <UserPlusIcon size={13} /> Пригласить
          </button>
        )}
      </div>
      {detail.members.length === 0 && <div className="empty-state">Нет участников</div>}
      {detail.members.map((m) => {
        const isSelf = m.user.id === actor.id;
        const assignable = assignableRoles(actor, m.role);
        const removable = !isSelf && canRemoveMember(actor, { id: m.user.id, role: m.role });
        const menuOpen = roleMenu === m.user.id;
        return (
          <div className="member-row" key={m.user.id}>
            <Avatar
              name={m.user.displayName}
              color={m.user.avatarColor}
              size={32}
              showDot
              online={online.has(m.user.id)}
            />
            <div className="who">
              <div className="nm">
                {m.user.displayName}
                {isSelf && <span className="muted"> (вы)</span>}
              </div>
              <div className="un">@{m.user.username}</div>
            </div>
            <span className={`role-badge ${m.role}`}>{roleLabel(m.role)}</span>
            <div className="member-actions">
              {!isSelf && (
                <button
                  className="icon-btn"
                  title="Написать сообщение"
                  onClick={() => {
                    void startDM(m.user.id);
                    closePanel();
                  }}
                >
                  <MessageIcon size={15} />
                </button>
              )}
              {(assignable.length > 0 || removable) && (
                <button
                  className="icon-btn"
                  title="Действия"
                  onClick={() => setRoleMenu(menuOpen ? null : m.user.id)}
                >
                  <MoreIcon size={15} />
                </button>
              )}
            </div>
            {menuOpen && (
              <div className="dropdown" style={{ top: 'auto', bottom: 8, left: 'auto', right: 8, width: 240 }} ref={menuRef}>
                {assignable.map((r) => (
                  <button
                    key={r}
                    className="dropdown-item"
                    onClick={() => void changeRole(m, r)}
                  >
                    <span className="grow">{roleLabel(r)}</span>
                    {r === m.role && <span className="muted">текущая</span>}
                  </button>
                ))}
                {removable && (
                  <>
                    {assignable.length > 0 && <div className="dropdown-sep" />}
                    <button
                      className="dropdown-item danger"
                      onClick={() => {
                        setRoleMenu(null);
                        setRemoveTarget(m);
                      }}
                    >
                      <TrashIcon size={14} />
                      <span className="grow">Исключить из организации</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  /* ---------------- tabs: pending invites ---------------- */

  const renderInvites = () => {
    if (!canViewOrgInvites(rank)) {
      return <div className="empty-state">Нет доступа к приглашениям</div>;
    }
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p className="panel-section-title" style={{ margin: 0 }}>
            Исходящие приглашения
          </p>
          {canInvite(rank) && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowInvite(true)}>
              <UserPlusIcon size={13} /> Пригласить
            </button>
          )}
        </div>
        {pending === null && <div className="empty-state">Загрузка…</div>}
        {pending !== null && pending.length === 0 && (
          <div className="empty-state">Нет приглашений</div>
        )}
        {pending?.map((inv) => {
          const inviterId = inv.inviter?.id ?? null;
          const cancellable = canCancelInvite(actor, inviterId);
          return (
            <div className="invite-card" key={inv.id}>
              <div className="row">
                <Avatar
                  name={inv.invitee?.displayName ?? '??'}
                  color={inv.invitee?.avatarColor ?? '#6C5CE7'}
                  size={30}
                />
                <div className="grow">
                  <div className="org">{inv.invitee?.displayName ?? 'Пользователь'}</div>
                  <div className="meta">
                    @{inv.invitee?.username ?? '—'} · {roleLabel(inv.role)} ·{' '}
                    {dateFmt.format(inv.createdAt)}
                  </div>
                </div>
              </div>
              {cancellable && (
                <div className="actions">
                  <button className="btn btn-danger btn-sm" onClick={() => setCancelTarget(inv)}>
                    Отменить приглашение
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  /* ---------------- tabs: info ---------------- */

  const renderInfo = () => (
    <>
      <p className="panel-section-title">Об организации</p>
      <div className="info-card">
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{detail.org.name}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>
          {detail.org.description?.trim() ? detail.org.description : 'Описание не добавлено'}
        </div>
        {canEditOrg(rank) && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 12 }}
            onClick={() => setShowEditOrg(true)}
          >
            <PencilIcon size={13} /> Редактировать
          </button>
        )}
      </div>

      <div className="info-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <div className="info-kv">
          <span className="k">Участников</span>
          <span className="v">{detail.members.length}</span>
        </div>
        <div className="info-kv">
          <span className="k">Каналов</span>
          <span className="v">{detail.channels.length}</span>
        </div>
        <div className="info-kv">
          <span className="k">Создана</span>
          <span className="v">{dateFmt.format(detail.org.createdAt)}</span>
        </div>
        <div className="info-kv">
          <span className="k">Ваша роль</span>
          <span className="v">
            <span className={`role-badge ${actor.role}`}>{roleLabel(actor.role)}</span>
          </span>
        </div>
      </div>

      {canCreateChannel(rank) && (
        <div className="hint" style={{ marginTop: 4 }}>
          Вы можете создавать каналы и приглашать участников.
        </div>
      )}
    </>
  );

  return (
    <aside className="right-panel">
      <div className="panel-head">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={panelTab === t.id ? 'panel-tab active' : 'panel-tab'}
            onClick={() => setPanelTab(t.id)}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
        <button className="icon-btn" title="Закрыть панель" onClick={closePanel}>
          <XIcon size={16} />
        </button>
      </div>

      <div className="panel-body">
        {panelTab === 'members' && renderMembers()}
        {panelTab === 'invites' && renderInvites()}
        {panelTab === 'info' && renderInfo()}
      </div>

      {canLeaveOrg(actor) && (
        <div className="panel-footer">
          <button className="btn btn-danger btn-block" onClick={() => setLeaveConfirm(true)}>
            <DoorOpenIcon size={15} /> Покинуть организацию
          </button>
        </div>
      )}

      {showEditOrg && <EditOrgModal onClose={() => setShowEditOrg(false)} />}
      {showInvite && (
        <InviteUserModal
          onClose={() => setShowInvite(false)}
          onInvited={() => void loadPending()}
        />
      )}
      {removeTarget && (
        <ConfirmModal
          title="Исключить участника?"
          text={`${removeTarget.user.displayName} потеряет доступ к организации и всем её чатам.`}
          confirmLabel="Исключить"
          onConfirm={removeMember}
          onClose={() => setRemoveTarget(null)}
        />
      )}
      {cancelTarget && (
        <ConfirmModal
          title="Отменить приглашение?"
          text={`Приглашение для @${cancelTarget.invitee?.username ?? 'пользователя'} будет отменено.`}
          confirmLabel="Отменить приглашение"
          onConfirm={cancelInvite}
          onClose={() => setCancelTarget(null)}
        />
      )}
      {leaveConfirm && (
        <ConfirmModal
          title="Покинуть организацию?"
          text={`Вы больше не сможете читать чаты организации «${detail.org.name}». Договор можно будет подписать заново только по новому приглашению.`}
          confirmLabel="Покинуть"
          onConfirm={leaveOrg}
          onClose={() => setLeaveConfirm(false)}
        />
      )}
    </aside>
  );
}
