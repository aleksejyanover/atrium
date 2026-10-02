/** Profile: identity, password, personal signature and the owner card (SPEC v3 §17, v5 §29/§30, v6 §32). */

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { useApp } from '../store';
import { balanceText } from '../types';
import { renderTypedSignature } from '../signature';
import { SignatureView } from './Signature';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { ConfirmModal } from './Modal';
import { Avatar } from './Avatar';
import { OwnerBadge } from './OwnerBadge';
import {
  CrownIcon,
  KeyIcon,
  LogOutIcon,
  MenuIcon,
  PenIcon,
  UserIcon,
  WalletIcon,
  DashboardIcon,
} from './icons';

interface ScreenProps {
  onOpenNav: () => void;
}

type SigMode = 'idle' | 'typed' | 'drawn';

/**
 * Серийный номер карточки владельца: детерминированная маска `OWNER-XXXX`
 * из id пользователя (4 hex-символа, FNV-1a) — SPEC v5 §30.
 */
function ownerSerial(id: string): string {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const tail = (hash >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(-4);
  return `OWNER-${tail}`;
}

/** «4242123456789012» → «•••• •••• •••• 9012» (маска номера карты, SPEC v6 §32). */
function maskCardNumber(number: string): string {
  const digits = number.replace(/\D/g, '');
  return `•••• •••• •••• ${digits.slice(-4)}`;
}

/** «4242123456789012» → «4242 1234 5678 9012». */
function groupCardNumber(number: string): string {
  return number.replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export function ProfileScreen({ onOpenNav }: ScreenProps) {
  const { user, updateUser, refreshUser, toast, logout, setView } = useApp();

  /* ---- identity ---- */
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  /* ---- owner card (SPEC v5 §29, v6 §32) ---- */
  const [ownerCode, setOwnerCode] = useState('');
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [showCardNumber, setShowCardNumber] = useState(false);

  /* ---- password ---- */
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  /* ---- signature ---- */
  const [mode, setMode] = useState<SigMode>('idle');
  const [typedText, setTypedText] = useState('');
  const [hasInk, setHasInk] = useState(false);
  const [sigBusy, setSigBusy] = useState(false);
  const [sigError, setSigError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const padRef = useRef<SignaturePadHandle>(null);

  const saved = user?.signature ? user.signature : null;
  const savedKind = user?.signatureKind === 'typed' ? 'typed' : 'drawn';

  // keep the form in sync when the profile arrives / changes elsewhere
  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName);
    setFullName(user.fullName ?? '');
  }, [user]);

  const startTyped = () => {
    setSigError(null);
    setTypedText(user?.fullName || user?.displayName || '');
    setMode('typed');
  };

  const startDrawn = () => {
    setSigError(null);
    setHasInk(false);
    setMode('drawn');
  };

  const saveProfile = async () => {
    const name = displayName.trim();
    if (name.length < 2 || name.length > 50) {
      setProfileError('Отображаемое имя — от 2 до 50 символов');
      return;
    }
    setProfileBusy(true);
    setProfileError(null);
    try {
      const { user: updated } = await api.patchMe({
        displayName: name,
        fullName: fullName.trim(),
      });
      updateUser(updated);
      toast('Профиль сохранён', 'success');
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : 'Не удалось сохранить профиль');
    } finally {
      setProfileBusy(false);
    }
  };

  /** Активация карточки владельца (SPEC v5 §29): POST /api/owner/claim {code}. */
  const claimOwner = async () => {
    const code = ownerCode.trim();
    if (!code) {
      setOwnerError('Введите код владельца');
      return;
    }
    setOwnerBusy(true);
    setOwnerError(null);
    try {
      const res = await api.ownerClaim(code);
      await refreshUser();
      setOwnerCode('');
      toast(
        res.already
          ? 'Карточка владельца уже активирована'
          : '👑 Карточка владельца активирована',
        'success',
      );
    } catch (e) {
      // 400 → «Неверный код» (SPEC v5 §29)
      setOwnerError(
        e instanceof ApiError && e.status === 400
          ? 'Неверный код'
          : e instanceof Error
            ? e.message
            : 'Не удалось активировать код',
      );
    } finally {
      setOwnerBusy(false);
    }
  };

  const savePassword = async () => {
    if (!currentPassword || newPassword.length < 6) {
      setPwError('Введите текущий пароль и новый пароль (минимум 6 символов)');
      return;
    }
    setPwBusy(true);
    setPwError(null);
    try {
      const { user: updated } = await api.patchMe({ currentPassword, password: newPassword });
      updateUser(updated);
      setCurrentPassword('');
      setNewPassword('');
      toast('Пароль обновлён', 'success');
    } catch (e) {
      setPwError(e instanceof Error ? e.message : 'Не удалось сменить пароль');
    } finally {
      setPwBusy(false);
    }
  };

  const saveTypedSignature = async () => {
    const text = typedText.trim();
    if (text.length < 2 || text.length > 80) {
      setSigError('Подпись — от 2 до 80 символов');
      return;
    }
    setSigBusy(true);
    setSigError(null);
    try {
      const dataUrl = renderTypedSignature(text);
      const { user: updated } = await api.patchMe({ signature: dataUrl, signatureKind: 'typed' });
      updateUser(updated);
      setMode('idle');
      toast('Подпись сохранена', 'success');
    } catch (e) {
      setSigError(e instanceof Error ? e.message : 'Не удалось сохранить подпись');
    } finally {
      setSigBusy(false);
    }
  };

  const saveDrawnSignature = async () => {
    const dataUrl = padRef.current?.toDataURL();
    if (!dataUrl) {
      setSigError('Сначала нарисуйте подпись');
      return;
    }
    setSigBusy(true);
    setSigError(null);
    try {
      const { user: updated } = await api.patchMe({ signature: dataUrl, signatureKind: 'drawn' });
      updateUser(updated);
      setMode('idle');
      toast('Подпись сохранена', 'success');
    } catch (e) {
      setSigError(e instanceof Error ? e.message : 'Не удалось сохранить подпись');
    } finally {
      setSigBusy(false);
    }
  };

  const deleteSignature = async () => {
    setSigBusy(true);
    try {
      const { user: updated } = await api.clearSignature();
      updateUser(updated);
      setConfirmDelete(false);
      setMode('idle');
      toast('Подпись удалена', 'info');
    } catch (e) {
      setConfirmDelete(false);
      toast(e instanceof Error ? e.message : 'Не удалось удалить подпись', 'error');
    } finally {
      setSigBusy(false);
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
            <div className="screen-title">Профиль</div>
            <div className="screen-sub">Личные данные, пароль и подпись для договоров</div>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout}>
          <LogOutIcon size={14} /> Выйти
        </button>
      </div>

      <div className="list-column">
        {/* ------------- identity ------------- */}
        <div className="info-card profile-card">
          <div className="profile-head">
            <Avatar name={user?.displayName ?? '?'} color={user?.avatarColor ?? '#7C6CF6'} size={64} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minWidth: 0,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 16 }}>{user?.displayName}</span>
                {user?.isOwner && <OwnerBadge />}
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                @{user?.username}
              </div>
            </div>
          </div>

          {profileError && <div className="form-error">{profileError}</div>}

          <div className="field">
            <label>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <UserIcon size={12} /> Отображаемое имя
              </span>
            </label>
            <input
              className="input"
              value={displayName}
              maxLength={50}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Имя пользователя</label>
            <input className="input" value={`@${user?.username ?? ''}`} disabled />
          </div>

          <div className="field">
            <label>Email</label>
            <input className="input" value={user?.email ?? ''} disabled />
          </div>

          <div className="field">
            <label>ФИО (для договоров)</label>
            <input
              className="input"
              value={fullName}
              maxLength={120}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Иванов Иван Иванович"
            />
            <span className="hint">Подставляется в договоры при подписи</span>
          </div>

          <button
            className="btn btn-primary"
            disabled={profileBusy}
            onClick={() => void saveProfile()}
          >
            {profileBusy ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>

        {/* ------------- wallet & creator panel ------------- */}
        <div className="info-card">
          <p className="panel-section-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <WalletIcon size={13} /> Кошелёк
          </p>
          <div className="profile-wallet-row">
            <div>
              <div className="muted" style={{ fontSize: 12 }}>
                Баланс
              </div>
              {/* SPEC v6 §32: баланс владельца — обычное число */}
              <div className="wallet-balance compact">{balanceText(user?.balance)}</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setView('wallet')}>
              Открыть кошелёк
            </button>
          </div>

          {user?.isAdmin && (
            <>
              <div className="dropdown-sep" />
              <p
                className="panel-section-title"
                style={{ display: 'flex', alignItems: 'center', gap: 7 }}
              >
                <DashboardIcon size={13} /> Панель создателя
              </p>
              <button className="btn btn-ghost btn-block" onClick={() => setView('admin')}>
                <DashboardIcon size={14} /> Открыть панель
              </button>
            </>
          )}
        </div>

        {/* ------------- карточка владельца (SPEC v5 §29/§30, v6 §32) ------------- */}
        <div className="info-card">
          <p className="panel-section-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <CrownIcon size={13} /> Карточка владельца
          </p>

          {ownerError && <div className="form-error">{ownerError}</div>}

          {!user?.isOwner && (
            <>
              <div className="field">
                <label>Код владельца</label>
                <input
                  className="input"
                  value={ownerCode}
                  maxLength={64}
                  placeholder="OWNER-…"
                  onChange={(e) => setOwnerCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void claimOwner();
                  }}
                />
                <span className="hint">Введите код, чтобы получить карточку владельца</span>
              </div>
              <button
                className="btn btn-primary"
                disabled={ownerBusy}
                onClick={() => void claimOwner()}
              >
                {ownerBusy ? 'Активация…' : 'Активировать'}
              </button>
            </>
          )}

          {user?.isOwner && user && (
            <>
              <div className="owner-card">
                <div className="owner-card-head">
                  <span className="owner-card-tag">ВЛАДЕЛЕЦ</span>
                  <span className="owner-card-chip" aria-hidden />
                </div>
                <div className="owner-card-name">{user.displayName}</div>
                <div className="owner-card-handle">@{user.username}</div>

                {user.card && (
                  <div className="owner-card-number">
                    <div className="owner-card-number-label">Номер карты</div>
                    <div className="owner-card-number-value">
                      {showCardNumber
                        ? groupCardNumber(user.card.number)
                        : maskCardNumber(user.card.number)}
                    </div>
                    <button
                      className="btn btn-ghost btn-sm owner-card-number-toggle"
                      onClick={() => setShowCardNumber((v) => !v)}
                    >
                      {showCardNumber ? 'Скрыть номер' : 'Показать номер'}
                    </button>
                    <div className="owner-card-pin">
                      Пароль карты: <span className="owner-card-pin-value">{user.card.pin}</span>
                    </div>
                    <div className="hint">Пароль запрашивается при каждой операции с деньгами</div>
                  </div>
                )}

                <div className="owner-card-foot">
                  <span className="owner-card-balance">Баланс: {balanceText(user.balance)}</span>
                  <span className="owner-card-serial">{ownerSerial(user.id)}</span>
                </div>
              </div>
              <span className="hint" style={{ display: 'block', marginTop: 10 }}>
                Вас всегда делают владельцем организации при вступлении
              </span>
            </>
          )}
        </div>

        {/* ------------- password ------------- */}
        <div className="info-card">
          <p className="panel-section-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <KeyIcon size={13} /> Смена пароля
          </p>
          {pwError && <div className="form-error">{pwError}</div>}
          <div className="sign-row">
            <div className="field">
              <label>Текущий пароль</label>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Новый пароль</label>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="минимум 6 символов"
              />
            </div>
          </div>
          <button
            className="btn btn-ghost"
            disabled={pwBusy}
            onClick={() => void savePassword()}
          >
            {pwBusy ? 'Сохранение…' : 'Сменить пароль'}
          </button>
        </div>

        {/* ------------- my signature ------------- */}
        <div className="info-card">
          <p className="panel-section-title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <PenIcon size={13} /> Моя подпись
          </p>

          {sigError && <div className="form-error">{sigError}</div>}

          {mode === 'idle' && !saved && (
            <div className="sig-empty">
              <div className="sig-stub" aria-hidden>
                <span className="sig-stub-line" />
                <span className="sig-stub-line short" />
              </div>
              <div className="hint" style={{ fontSize: 13 }}>
                Создайте свою подпись — потом будете подписывать документы в один клик
              </div>
              <div className="sig-empty-actions">
                <button className="btn btn-primary btn-sm" onClick={startTyped}>
                  <PenIcon size={13} /> Напечатать подпись
                </button>
                <button className="btn btn-ghost btn-sm" onClick={startDrawn}>
                  Нарисовать подпись
                </button>
              </div>
            </div>
          )}

          {mode === 'idle' && saved && (
            <div>
              <div className="sig-preview">
                <SignatureView signature={user?.signature} signatureText={user?.signatureText} />
              </div>
              <div className="sig-empty-actions" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => (savedKind === 'typed' ? startTyped() : startDrawn())}
                >
                  Изменить
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={sigBusy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Удалить подпись
                </button>
              </div>
            </div>
          )}

          {mode === 'typed' && (
            <div>
              <div className="field">
                <label>Напечатать подпись</label>
                <input
                  className="input"
                  value={typedText}
                  maxLength={80}
                  onChange={(e) => setTypedText(e.target.value)}
                  placeholder="Например, Алексей Иванов"
                  autoFocus
                />
                <span className="hint">
                  Введите имя или фразу — так будет выглядеть ваша подпись
                </span>
              </div>
              <div className="typed-sig-preview">
                {typedText.trim() ? (
                  <span className="sig-text large">{typedText}</span>
                ) : (
                  <span className="muted">Превью появится здесь</span>
                )}
              </div>
              <div className="sig-empty-actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={sigBusy}
                  onClick={() => void saveTypedSignature()}
                >
                  {sigBusy ? 'Сохранение…' : 'Сохранить подпись'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setMode('idle')}>
                  Отмена
                </button>
              </div>
            </div>
          )}

          {mode === 'drawn' && (
            <div>
              <div className="sig-head">
                <span className="sig-label">Нарисовать подпись</span>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!hasInk}
                  onClick={() => padRef.current?.clear()}
                >
                  Очистить
                </button>
              </div>
              <SignaturePad ref={padRef} onInkChange={setHasInk} />
              <div className="hint" style={{ marginTop: 5 }}>
                Или нарисуйте подпись курсором / пальцем
              </div>
              <div className="sig-empty-actions">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={sigBusy || !hasInk}
                  onClick={() => void saveDrawnSignature()}
                >
                  {sigBusy ? 'Сохранение…' : 'Сохранить подпись'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setMode('idle')}>
                  Отмена
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Удалить подпись?"
          text="Сохранённая подпись исчезнет, и при подписании договоров придётся расписываться заново."
          confirmLabel="Удалить"
          onConfirm={deleteSignature}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
