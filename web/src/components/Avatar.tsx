import type { User } from '../types';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  // Пустое имя (например, системный бот, SPEC v9 §37) — осознанная заглушка.
  if (parts.length === 0) return '🤖';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? '') + (parts[1][0] ?? '');
}

const SIZE_REM: Record<string, number> = {
  xs: 20,
  sm: 26,
  md: 34,
  lg: 44,
};

export interface AvatarProps {
  name: string;
  color: string;
  size?: keyof typeof SIZE_REM | number;
  online?: boolean;
  showDot?: boolean;
  title?: string;
}

export function Avatar({ name, color, size = 'md', online, showDot, title }: AvatarProps) {
  const px = typeof size === 'number' ? size : SIZE_REM[size];
  const avatar = (
    <span
      className="avatar"
      style={{
        width: px,
        height: px,
        // пустой цвет (бот может быть без avatarColor) — фирменный фолбэк
        background: color || 'var(--accent-2)',
        fontSize: Math.max(9, Math.round(px * 0.36)),
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );

  if (!showDot) {
    return <span title={title}>{avatar}</span>;
  }

  return (
    <span className="avatar-wrap" title={title}>
      {avatar}
      {online && <span className="online-dot" />}
    </span>
  );
}

export function userInitials(u: Pick<User, 'displayName' | 'username'>): string {
  return initials(u.displayName || u.username);
}
