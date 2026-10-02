/** My dismissal contracts: list, pending signing pad, history (SPEC v2 §14.4). */

import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import { documentStatusLabel, type Doc, type MyDocument } from '../types';
import { ConfirmModal } from './Modal';
import { SavedSignaturePanel, SignatureView } from './Signature';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { ArrowLeftIcon, FileTextIcon, MenuIcon } from './icons';

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
  if (status === 'signed') return 'status-badge signed';
  if (status === 'terminated' || status === 'rejected') return 'status-badge rejected';
  return 'status-badge';
}

/* ---------------- pending document ---------------- */

function SignDocument({
  entry,
  onBack,
}: {
  entry: MyDocument;
  onBack: () => void;
}) {
  const {
    user,
    setView,
    refreshMyDocuments,
    refreshOrgs,
    refreshDetail,
    toast,
  } = useApp();
  const doc = entry.document;
  const [name, setName] = useState(user?.fullName || user?.displayName || '');
  const [used, setUsed] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);

  const nameOk = name.trim().length >= 2;
  const canSign = nameOk && (used || hasInk) && !busy;

  const useMine = () => {
    if (used) {
      setUsed(false);
      return;
    }
    setUsed(true);
    setName(user?.fullName || user?.displayName || '');
  };

  const sign = async () => {
    if (!canSign) return;
    const dataUrl = used ? user?.signature ?? undefined : padRef.current?.toDataURL();
    if (!dataUrl) {
      toast('Подпись не поставлена', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.signDocument(doc.id, { signatureDataUrl: dataUrl, signedName: name.trim() });
      await Promise.all([refreshMyDocuments(), refreshOrgs(), refreshDetail()]);
      toast('Договор подписан — членство завершено', 'info');
      onBack();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Не удалось подписать договор', 'error');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      await api.rejectDocument(doc.id);
      setConfirmReject(false);
      await refreshMyDocuments();
      toast('Вы оспорили договор об увольнении — членство сохранено', 'success');
      onBack();
    } catch (e) {
      setConfirmReject(false);
      toast(e instanceof Error ? e.message : 'Не удалось оспорить договор', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="invite-detail">
      <div className="screen-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button className="icon-btn" onClick={onBack} title="Назад">
            <ArrowLeftIcon size={17} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="screen-title">Договор об увольнении</div>
            <div className="screen-sub">
              Организация «{entry.org.name}» · {dateFmt.format(doc.createdAt)}
            </div>
          </div>
        </div>
        <span className={statusClass(doc.status)}>{documentStatusLabel(doc.status)}</span>
      </div>

      {doc.message?.trim() && <div className="quote-box">{doc.message}</div>}

      <div className="panel-section-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <FileTextIcon size={13} /> Текст договора
      </div>
      <div className="contract-box">{doc.contractText?.trim() || 'Текст договора недоступен.'}</div>

      <div className="panel-section-title" style={{ marginTop: 18 }}>
        Подпись
      </div>
      <div className="sign-card" style={{ marginTop: 0 }}>
        <SavedSignaturePanel
          profile={user}
          used={used}
          onUse={useMine}
          onOpenProfile={() => setView('profile')}
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
              {!hasInk && (
                <div className="hint" style={{ marginTop: 5 }}>
                  Подпись не поставлена
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sign-actions">
          <button
            className="btn btn-danger-filled"
            disabled={!canSign}
            onClick={() => void sign()}
          >
            {busy ? 'Подписание…' : 'Подписать и уволиться'}
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => setConfirmReject(true)}
          >
            Оспорить
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          После подписи членство в организации завершится. «Оспорить» оставит вас в составе.
        </div>
      </div>

      {confirmReject && (
        <ConfirmModal
          title="Оспорить договор?"
          text="Договор об увольнении будет отклонён, ваше членство в организации сохранится."
          confirmLabel="Оспорить"
          danger={false}
          onConfirm={reject}
          onClose={() => !busy && setConfirmReject(false)}
        />
      )}
    </div>
  );
}

/* ---------------- list ---------------- */

export function DocumentsScreen({ onOpenNav }: ScreenProps) {
  const { myDocuments, refreshMyDocuments, setView } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void refreshMyDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = myDocuments.find((d) => d.document.id === selectedId) ?? null;

  if (selected && selected.document.status === 'pending') {
    return (
      <div className="screen">
        <SignDocument entry={selected} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="screen-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button className="icon-btn only-mobile" onClick={onOpenNav} title="Меню">
            <MenuIcon />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="screen-title">Документы</div>
            <div className="screen-sub">Договоры об увольнении и история их статусов</div>
          </div>
        </div>
      </div>

      {myDocuments.length === 0 ? (
        <div className="empty-state" style={{ padding: '48px 10px' }}>
          <FileTextIcon size={26} />
          <div style={{ marginTop: 10 }}>Договоров пока нет</div>
        </div>
      ) : (
        <div className="list-column">
          {myDocuments.map((entry) => {
            const doc = entry.document;
            const pending = doc.status === 'pending';
            return (
              <div className="invite-card" key={doc.id}>
                <div className="row">
                  <div className="grow">
                    <div className="org">{entry.org.name}</div>
                    <div className="meta">
                      Договор об увольнении · {dateFmt.format(doc.createdAt)}
                    </div>
                  </div>
                  <span className={statusClass(doc.status)}>
                    {documentStatusLabel(doc.status)}
                  </span>
                </div>

                {doc.message?.trim() && <div className="quote-box">{doc.message}</div>}

                {pending ? (
                  <div className="actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setSelectedId(doc.id)}
                    >
                      Открыть и подписать
                    </button>
                  </div>
                ) : (
                  <div className="history-entry">
                    <div className="contract-toggle">
                      <button
                        className="link-btn"
                        onClick={() => setSelectedId(selectedId === doc.id ? null : doc.id)}
                      >
                        {selectedId === doc.id ? 'Скрыть договор' : 'Показать договор'}
                      </button>
                    </div>
                    {selectedId === doc.id && (
                      <>
                        <div className="contract-box small">{doc.contractText ?? ''}</div>
                        {(doc.signature || doc.signatureText) && (
                          <div className="sig-preview" style={{ marginTop: 10 }}>
                            <div className="hint" style={{ marginBottom: 6 }}>
                              Подпись: {doc.signedName ?? ''}
                              {doc.signedAt ? ` · ${dateFmt.format(doc.signedAt)}` : ''}
                            </div>
                            <SignatureView
                              signature={doc.signature}
                              signatureText={doc.signatureText}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div className="hint" style={{ marginTop: 14 }}>
            Договоры создаются штатом организации (роль «Админ» и выше).
          </div>
          <button
            className="link-btn"
            style={{ marginTop: 6 }}
            onClick={() => setView('profile')}
          >
            Изменить подпись в профиле
          </button>
        </div>
      )}
    </div>
  );
}
