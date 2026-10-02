/** Shared signature widgets: preview of a stored signature + «use my signature» panel. */

import type { User } from '../types';
import { CheckIcon, PenIcon } from './icons';

/**
 * Renders a signature attached to a signed contract: an image via `<img>` or a
 * typed text with the Caveat cursive font (SPEC v3 §17).
 */
export function SignatureView({
  signature,
  signatureText,
  compact,
}: {
  signature?: string | null;
  signatureText?: string | null;
  compact?: boolean;
}) {
  if (signature) {
    return (
      <img
        className={compact ? 'sig-img compact' : 'sig-img'}
        src={signature}
        alt="Подпись"
      />
    );
  }
  if (signatureText && signatureText.trim()) {
    return <span className="sig-text">{signatureText}</span>;
  }
  return <span className="muted">Подпись не поставлена</span>;
}

interface SavedSignaturePanelProps {
  profile: User | null;
  used: boolean;
  onUse: () => void;
  onOpenProfile: () => void;
}

/**
 * «Использовать мою подпись» panel shown above any contract signing form.
 * When no signature is saved yet — a hint that links to the profile (SPEC
 * v3 §17, last paragraph).
 */
export function SavedSignaturePanel({ profile, used, onUse, onOpenProfile }: SavedSignaturePanelProps) {
  const saved = profile?.signature ? profile : null;

  if (!saved) {
    return (
      <div className="sig-saved hint-banner">
        <div>
          Создайте свою подпись в профиле — подписание займёт один клик
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onOpenProfile}>
          <PenIcon size={13} /> Создать подпись
        </button>
      </div>
    );
  }

  return (
    <div className={used ? 'sig-saved active' : 'sig-saved'}>
      <div className="sig-saved-preview">
        <SignatureView signature={saved.signature} signatureText={saved.signatureText} compact />
      </div>
      <div className="sig-saved-body">
        <div className="sig-saved-title">Использовать мою подпись</div>
        <div className="hint">ФИО подставится из профиля — его можно поправить</div>
      </div>
      {used ? (
        <div className="sig-saved-actions">
          <span className="status-badge signed">
            <CheckIcon size={11} /> Подпись применена
          </span>
          <button className="btn btn-ghost btn-sm" onClick={onUse}>
            Убрать
          </button>
        </div>
      ) : (
        <div className="sig-saved-actions">
          <button className="btn btn-primary btn-sm" onClick={onUse}>
            Использовать мою подпись
          </button>
        </div>
      )}
      <button className="link-btn" onClick={onOpenProfile}>
        Изменить подпись
      </button>
    </div>
  );
}
