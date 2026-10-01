/** Incoming invites → contract view + drawn signature → join org. */

import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { roleLabel, unwrapUser, type IncomingInvite } from '../types';
import { Avatar } from './Avatar';
import { ConfirmModal, Modal } from './Modal';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { ArrowLeftIcon, FileTextIcon, MailIcon } from './icons';

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/* ---------------- detail: contract + signature ---------------- */

function InviteDetail({ invite, onBack }: { invite: IncomingInvite; onBack: () => void }) {
  const { refreshOrgs, refreshInvites, selectOrg, setView, toast } = useApp();
  const inviter = unwrapUser(invite.inviter);

  const [name, setName] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);

  const nameOk = name.trim().length >= 2;
  const canSubmit = nameOk && hasInk && !busy;

  const openConfirm = () => {
    const dataUrl = padRef.current?.toDataURL();
    if (!dataUrl || !nameOk) return;
    setSignature(dataUrl);
    setShowConfirm(true);
  };

  const accept = async () => {
    if (!signature) return;
    setBusy(true);
    try {
      const { org } = await api.acceptInvite(invite.invite.id, signature, name.trim());
      await Promise.all([refreshOrgs(), refreshInvites()]);
      selectOrg(org.id);
      setView('chat');
      setShowConfirm(false);
      toast(`Вы присоединились к организации «${org.name}»`, 'success');
    } catch (e) {
      setShowConfirm(false);
      toast(e instanceof Error ? e.message : 'Не удалось подписать договор', 'error');
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    try {
      await api.declineInvite(invite.invite.id);
      await refreshInvites();
      toast('Приглашение отклонено', 'info');
      onBack();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось отклонить приглашение', 'error');
    }
  };

  return (
    <div className="screen">
      <div className="invite-detail">
        <div className="screen-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <button className="icon-btn" onClick={onBack} title="Назад">
              <ArrowLeftIcon size={17} />
            </button>
            <div style={{ minWidth: 0 }}>
              <div className="screen-title">Договор о присоединении</div>
              <div className="screen-sub">
                Организация «{invite.org.name}»
                {inviter?.displayName ? ` · приглашает ${inviter.displayName}` : ''}
              </div>
            </div>
          </div>
        </div>

        <div className="sign-card" style={{ marginTop: 0, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar
              name={inviter?.displayName ?? invite.org.name}
              color={inviter?.avatarColor ?? '#6C5CE7'}
              size={34}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {inviter?.displayName ?? 'Администратор организации'}
              </div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                приглашает вас в роль «{roleLabel(invite.role)}» ·{' '}
                {dateFmt.format(invite.createdAt)}
              </div>
            </div>
            <span className={`role-badge ${invite.role}`}>{roleLabel(invite.role)}</span>
          </div>
        </div>

        <div className="panel-section-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <FileTextIcon size={13} /> Текст договора
        </div>
        <div className="contract-box">
          {invite.contractText?.trim() || 'Текст договора недоступен.'}
        </div>

        <div className="panel-section-title" style={{ marginTop: 18 }}>
          Подпись
        </div>
        <div className="sign-card" style={{ marginTop: 0 }}>
          <div className="sign-row">
            <div className="field">
              <label>ФИО</label>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Введите ФИО как в документе"
                maxLength={120}
              />
              {name.trim().length > 0 && !nameOk && (
                <span className="field-error">Введите ФИО полностью (минимум 2 символа)</span>
              )}
            </div>

            <div className="sig-pad-wrap">
              <div className="sig-head">
                <span className="sig-label">Распишитесь здесь</span>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!hasInk}
                  onClick={() => padRef.current?.clear()}
                >
                  Очистить
                </button>
              </div>
              <SignaturePad ref={padRef} onInkChange={setHasInk} />
              {!hasInk && <div className="hint" style={{ marginTop: 5 }}>Подпись не поставлена</div>}
            </div>
          </div>

          <div className="sign-actions">
            <button className="btn btn-primary" disabled={!canSubmit} onClick={openConfirm}>
              Подписать и вступить
            </button>
            <button className="btn btn-ghost" onClick={() => void decline()}>
              Отклонить приглашение
            </button>
          </div>
        </div>
      </div>

      {showConfirm && signature && (
        <Modal
          title="Подтвердите подпись"
          subtitle={`Вы подписываете договор и вступаете в организацию «${invite.org.name}» в роли «${roleLabel(invite.role)}»`}
          onClose={() => !busy && setShowConfirm(false)}
          footer={
            <>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setShowConfirm(false)}>
                Назад
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void accept()}>
                {busy ? 'Подписание…' : 'Подтвердить и вступить'}
              </button>
            </>
          }
        >
          <div className="field">
            <label>ФИО</label>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{name.trim()}</div>
          </div>
          <div className="field">
            <label>Подпись</label>
            <div className="sig-preview">
              <img src={signature} alt="Подпись" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- list ---------------- */

export function InvitesScreen() {
  const { invites, refreshInvites, toast } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<IncomingInvite | null>(null);

  useEffect(() => {
    void refreshInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = invites.find((i) => i.invite.id === selectedId) ?? null;

  if (selected) {
    return <InviteDetail invite={selected} onBack={() => setSelectedId(null)} />;
  }

  const decline = async () => {
    if (!declineTarget) return;
    try {
      await api.declineInvite(declineTarget.invite.id);
      await refreshInvites();
      setDeclineTarget(null);
      toast('Приглашение отклонено', 'info');
    } catch (e) {
      setDeclineTarget(null);
      toast(e instanceof Error ? e.message : 'Не удалось отклонить приглашение', 'error');
    }
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <div className="screen-title">Входящие приглашения</div>
          <div className="screen-sub">
            Подпишите договор, чтобы вступить в организацию
          </div>
        </div>
      </div>

      {invites.length === 0 ? (
        <div className="empty-state" style={{ padding: '48px 10px' }}>
          <MailIcon size={26} />
          <div style={{ marginTop: 10 }}>Нет входящих приглашений</div>
        </div>
      ) : (
        invites.map((inv) => {
          const inviter = unwrapUser(inv.inviter);
          return (
            <div className="invite-card" key={inv.invite.id} style={{ maxWidth: 640 }}>
              <div className="row">
                <Avatar
                  name={inviter?.displayName ?? inv.org.name}
                  color={inviter?.avatarColor ?? '#6C5CE7'}
                  size={38}
                />
                <div className="grow">
                  <div className="org">{inv.org.name}</div>
                  <div className="meta">
                    {inviter?.displayName ? `Приглашает ${inviter.displayName}` : 'Приглашение'}
                    {' · '}
                    роль «{roleLabel(inv.role)}» · {dateFmt.format(inv.createdAt)}
                  </div>
                </div>
                <span className={`role-badge ${inv.role}`}>{roleLabel(inv.role)}</span>
              </div>
              <div className="contract-preview">{inv.contractText || '—'}</div>
              <div className="actions">
                <button className="btn btn-primary btn-sm" onClick={() => setSelectedId(inv.invite.id)}>
                  Открыть договор
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setDeclineTarget(inv)}>
                  Отклонить
                </button>
              </div>
            </div>
          );
        })
      )}

      {declineTarget && (
        <ConfirmModal
          title="Отклонить приглашение?"
          text={`Вы отклоните приглашение в организацию «${declineTarget.org.name}». Позже его будет сложнее принять — потребуется новое приглашение.`}
          confirmLabel="Отклонить"
          onConfirm={decline}
          onClose={() => setDeclineTarget(null)}
        />
      )}
    </div>
  );
}
