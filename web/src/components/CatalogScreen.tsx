/** Catalog of public organizations + apply-with-contract modal (SPEC v2 §14.1–14.2). */

import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { buildJoinContract } from '../contract';
import type { DiscoverOrg } from '../types';
import { pluralRu } from '../types';
import { Modal } from './Modal';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { SavedSignaturePanel } from './Signature';
import { FileTextIcon, GlobeIcon, MenuIcon, PenIcon } from './icons';

interface ScreenProps {
  onOpenNav: () => void;
}

/* ---------------- apply modal ---------------- */

function ApplyModal({ org, onClose }: { org: DiscoverOrg; onClose: () => void }) {
  const { user, setView, refreshMyApplications, toast } = useApp();
  const [message, setMessage] = useState('');
  const [name, setName] = useState(user?.fullName || user?.displayName || '');
  const [used, setUsed] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const padRef = useRef<SignaturePadHandle>(null);

  const nameOk = name.trim().length >= 2;
  const canSubmit = nameOk && (used || hasInk) && !busy;

  const openProfile = () => {
    onClose();
    setView('profile');
  };

  const useMine = () => {
    if (used) {
      setUsed(false);
      return;
    }
    setUsed(true);
    setName(user?.fullName || user?.displayName || '');
  };

  const submit = async () => {
    if (!canSubmit) return;
    const dataUrl = used ? user?.signature ?? undefined : padRef.current?.toDataURL();
    if (!dataUrl) {
      setError('Подпись не поставлена');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.createApplication(org.id, {
        ...(message.trim() ? { message: message.trim() } : {}),
        signatureDataUrl: dataUrl,
        signedName: name.trim(),
      });
      await refreshMyApplications();
      toast('Заявление отправлено', 'success');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось подать заявление');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Подать заявление"
      subtitle={`Организация «${org.name}»`}
      onClose={() => !busy && onClose()}
      wide
      footer={
        <>
          <button className="btn btn-ghost" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? 'Отправка…' : 'Подать заявление'}
          </button>
        </>
      }
    >
      {error && <div className="form-error">{error}</div>}

      <div className="field">
        <label>Сообщение (необязательно)</label>
        <textarea
          className="textarea"
          value={message}
          maxLength={500}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Расскажите, почему хотите вступить"
        />
      </div>

      <div className="field">
        <label>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FileTextIcon size={12} /> Договор о присоединении
          </span>
        </label>
        <div className="contract-box small">{buildJoinContract(org.name, 'Участник')}</div>
      </div>

      <SavedSignaturePanel
        profile={user}
        used={used}
        onUse={useMine}
        onOpenProfile={openProfile}
      />

      <div className="sign-row" style={{ marginTop: 14 }}>
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

        {!used && (
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
        )}
      </div>
    </Modal>
  );
}

/* ---------------- catalog screen ---------------- */

export function CatalogScreen({ onOpenNav }: ScreenProps) {
  const { orgs, selectOrg, toast } = useApp();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<DiscoverOrg[] | null>(null);
  const [target, setTarget] = useState<DiscoverOrg | null>(null);

  // debounce 300ms (SPEC v2 §14.1)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    void api
      .discover(debounced)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setItems([]);
        toast(e instanceof Error ? e.message : 'Не удалось загрузить каталог', 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, toast]);

  const isMemberOrg = (o: DiscoverOrg) =>
    o.isMember || orgs.some((x) => x.id === o.id);

  return (
    <div className="screen">
      <div className="screen-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button className="icon-btn only-mobile" onClick={onOpenNav} title="Меню">
            <MenuIcon />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="screen-title">Каталог организаций</div>
            <div className="screen-sub">Найдите организацию и подайте заявление на вступление</div>
          </div>
        </div>
      </div>

      <div className="catalog-search">
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Найти организацию"
          maxLength={80}
        />
      </div>

      {items === null ? (
        <div className="empty-state" style={{ padding: '40px 10px' }}>
          Загрузка…
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state" style={{ padding: '40px 10px' }}>
          <GlobeIcon size={26} />
          <div style={{ marginTop: 10 }}>
            {debounced ? 'Ничего не найдено' : 'Нет публичных организаций'}
          </div>
        </div>
      ) : (
        <div className="catalog-grid">
          {items.map((o) => (
            <div className="org-card" key={o.id}>
              <div className="org-card-head">
                <div className="org-card-name">{o.name}</div>
                {isMemberOrg(o) && <span className="status-badge accent">Ваша организация</span>}
              </div>
              <div className="org-card-desc">
                {o.description?.trim() ? o.description : 'Описание не добавлено'}
              </div>
              <div className="org-card-meta">
                {o.membersCount}{' '}
                {pluralRu(o.membersCount, 'участник', 'участника', 'участников')}
              </div>
              <div className="org-card-actions">
                {isMemberOrg(o) ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => selectOrg(o.id)}>
                    Открыть
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => setTarget(o)}>
                    <PenIcon size={13} /> Подать заявление
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {target && <ApplyModal org={target} onClose={() => setTarget(null)} />}
    </div>
  );
}
