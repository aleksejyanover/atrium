/** Incoming applications (staff) + my outgoing applications (SPEC v2 §14.3). */

import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import {
  applicationStatusLabel,
  roleLabel,
  roleRank,
  unwrapUser,
  type Doc,
} from '../types';
import { Avatar } from './Avatar';
import { ClipboardIcon, FileTextIcon, MenuIcon } from './icons';

interface ScreenProps {
  onOpenNav: () => void;
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function statusClass(status: Doc['status']): string {
  if (status === 'pending') return 'status-badge pending';
  if (status === 'approved') return 'status-badge approved';
  return 'status-badge rejected';
}

function ContractToggle({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="contract-toggle">
      <button className="link-btn" onClick={() => setOpen((v) => !v)}>
        {open ? 'Скрыть договор' : 'Показать договор'}
      </button>
      {open && <div className="contract-box small">{text}</div>}
    </div>
  );
}

export function ApplicationsScreen({ onOpenNav }: ScreenProps) {
  const {
    orgs,
    myApplications,
    incomingApplications,
    refreshApplications,
    refreshOrgs,
    refreshDetail,
    toast,
    setView,
  } = useApp();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void refreshApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const staffOrgs = orgs.filter((o) => roleRank(o.role) >= 40);
  const showIncoming = staffOrgs.length > 0;

  const accept = async (id: string) => {
    setBusyId(id);
    try {
      await api.acceptApplication(id);
      toast('Заявление принято — участник добавлен в организацию', 'success');
      await Promise.all([refreshApplications(), refreshDetail(), refreshOrgs()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось принять заявление', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    setBusyId(id);
    try {
      await api.rejectApplication(id);
      toast('Заявление отклонено', 'info');
      await Promise.all([refreshApplications(), refreshDetail()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось отклонить заявление', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const cancelMine = async (id: string) => {
    setBusyId(id);
    try {
      await api.cancelApplication(id);
      toast('Заявление отозвано', 'info');
      await refreshApplications();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось отозвать заявление', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button className="icon-btn only-mobile" onClick={onOpenNav} title="Меню">
            <MenuIcon />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="screen-title">Заявления</div>
            <div className="screen-sub">
              Входящие заявки организаций и статус ваших заявлений
            </div>
          </div>
        </div>
      </div>

      <div className="list-column">
        {/* ------------- incoming ------------- */}
        <p className="panel-section-title">Входящие заявки</p>
        {!showIncoming ? (
          <div className="empty-state" style={{ padding: '24px 10px' }}>
            Входящие заявки доступны в организациях, где вы админ (роль «Помощник админа» и выше)
          </div>
        ) : incomingApplications.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 10px' }}>
            <ClipboardIcon size={24} />
            <div style={{ marginTop: 8 }}>Нет входящих заявок</div>
          </div>
        ) : (
          incomingApplications.map(({ application, org, user: applicant }) => {
            const u = unwrapUser(applicant);
            return (
              <div className="invite-card" key={application.id}>
                <div className="row">
                  <Avatar
                    name={u?.displayName ?? 'Заявитель'}
                    color={u?.avatarColor ?? '#6C5CE7'}
                    size={38}
                  />
                  <div className="grow">
                    <div className="org">{u?.displayName ?? 'Пользователь'}</div>
                    <div className="meta">
                      {u ? `@${u.username} · ` : ''}
                      {org.name} · {dateFmt.format(application.createdAt)}
                    </div>
                  </div>
                  <span className={statusClass(application.status)}>
                    {applicationStatusLabel(application.status)}
                  </span>
                </div>

                {application.message?.trim() && (
                  <div className="quote-box">{application.message}</div>
                )}

                <ContractToggle text={application.contractText ?? ''} />

                {application.status === 'pending' && (
                  <div className="actions">
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busyId === application.id}
                      onClick={() => void accept(application.id)}
                    >
                      Принять
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={busyId === application.id}
                      onClick={() => void reject(application.id)}
                    >
                      Отклонить
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* ------------- mine ------------- */}
        <p className="panel-section-title" style={{ marginTop: 26 }}>
          Мои заявки
        </p>
        {myApplications.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 10px' }}>
            <FileTextIcon size={24} />
            <div style={{ marginTop: 8 }}>
              Вы ещё не подавали заявлений — загляните{' '}
              <button className="link-btn" onClick={() => setView('catalog')}>
                в каталог
              </button>
            </div>
          </div>
        ) : (
          myApplications.map(({ application, org }) => (
            <div className="invite-card" key={application.id}>
              <div className="row">
                <div className="grow">
                  <div className="org">{org.name}</div>
                  <div className="meta">Заявление от {dateFmt.format(application.createdAt)}</div>
                </div>
                <span className={statusClass(application.status)}>
                  {applicationStatusLabel(application.status)}
                </span>
              </div>

              {application.message?.trim() && (
                <div className="quote-box">{application.message}</div>
              )}
              <ContractToggle text={application.contractText ?? ''} />

              {application.status === 'pending' && (
                <div className="actions">
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={busyId === application.id}
                    onClick={() => void cancelMine(application.id)}
                  >
                    Отозвать
                  </button>
                </div>
              )}
            </div>
          ))
        )}

        <div className="hint" style={{ marginTop: 18 }}>
          Роль в новой организации: «{roleLabel('member')}» — повышает штат.
        </div>
      </div>
    </div>
  );
}
