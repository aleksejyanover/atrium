import { useApp } from '../store';
import { roleLabel } from '../types';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

interface CallTargetModalProps {
  kind: 'video' | 'audio';
  onPick: (peer: { id: string; name: string; color: string }) => void;
  onClose: () => void;
}

/** 1:1 calls only — pick whom to call inside a group channel. */
export function CallTargetModal({ kind, onPick, onClose }: CallTargetModalProps) {
  const { detail, online, user } = useApp();

  const members = (detail?.members ?? [])
    .filter((m) => m.user.id !== user?.id)
    .sort((a, b) => Number(online.has(b.user.id)) - Number(online.has(a.user.id)));

  return (
    <Modal
      title={kind === 'video' ? 'Видеозвонок' : 'Аудиозвонок'}
      subtitle="Кому позвонить? Звонки в Atrium — одиночные (1:1)"
      onClose={onClose}
    >
      {members.length === 0 ? (
        <div className="empty-state">Нет участников для звонка</div>
      ) : (
        <div className="search-results">
          {members.map((m) => (
            <button
              key={m.user.id}
              className="search-result"
              onClick={() =>
                onPick({
                  id: m.user.id,
                  name: m.user.displayName,
                  color: m.user.avatarColor,
                })
              }
            >
              <Avatar
                name={m.user.displayName}
                color={m.user.avatarColor}
                size={28}
                showDot
                online={online.has(m.user.id)}
              />
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                {m.user.displayName}
              </span>
              <span className={`role-badge ${m.role}`}>{roleLabel(m.role)}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
