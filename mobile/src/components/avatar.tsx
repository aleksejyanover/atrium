import { Text, View } from 'react-native';

import { colors, radius } from '@/lib/theme';
import { ROLE_LABELS, ROLE_RANK } from '@/lib/roles';
import { Role } from '@/lib/types';

interface Props {
  name: string;
  color?: string;
  size?: number;
  /** Green online dot (SPEC: online presence). */
  online?: boolean;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({ name, color = colors.accent, size = 40, online }: Props) {
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text
          style={{
            color: '#FFFFFF',
            fontSize: Math.round(size * 0.38),
            fontWeight: '600',
          }}>
          {initialsOf(name)}
        </Text>
      </View>
      {online !== undefined ? (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: Math.max(10, Math.round(size * 0.28)),
            height: Math.max(10, Math.round(size * 0.28)),
            borderRadius: Math.max(10, Math.round(size * 0.28)) / 2,
            backgroundColor: online ? colors.ok : colors.muted,
            borderColor: colors.bg,
            borderWidth: 2,
          }}
        />
      ) : null}
    </View>
  );
}

const ROLE_TINTS: Record<Role, { bg: string; fg: string }> = {
  owner: { bg: 'rgba(124,108,246,0.16)', fg: colors.accent },
  assistant_owner: { bg: 'rgba(124,108,246,0.12)', fg: '#9C90F8' },
  admin: { bg: 'rgba(62,207,142,0.12)', fg: colors.ok },
  assistant_admin: { bg: 'rgba(62,207,142,0.08)', fg: '#7FDCB6' },
  member: { bg: 'rgba(139,139,148,0.12)', fg: colors.muted },
};

export function RoleBadge({ role, compact }: { role: Role; compact?: boolean }) {
  const tint = ROLE_TINTS[role] ?? ROLE_TINTS.member;
  return (
    <View
      style={{
        backgroundColor: tint.bg,
        borderRadius: radius.sm,
        paddingHorizontal: compact ? 6 : 8,
        paddingVertical: 2,
        borderWidth: 1,
        borderColor: colors.border,
      }}>
      <Text style={{ color: tint.fg, fontSize: 11, fontWeight: '600' }}>
        {ROLE_LABELS[role] ?? role}
      </Text>
    </View>
  );
}

/** Small rank chip used to explain permission ordering in role pickers. */
export function RoleRank({ role }: { role: Role }) {
  return <Text style={{ color: colors.muted, fontSize: 11 }}>{ROLE_RANK[role]}</Text>;
}

/**
 * Золотая пилюля «Владелец» — поле isOwner пользователя (SPEC v5 §29–30):
 * фон rgba(245,190,65,.15), текст #F5BE41.
 */
export function OwnerBadge({ compact }: { compact?: boolean }) {
  return (
    <View
      style={{
        backgroundColor: 'rgba(245,190,65,0.15)',
        borderColor: 'rgba(245,190,65,0.45)',
        borderWidth: 1,
        borderRadius: radius.sm,
        paddingHorizontal: compact ? 6 : 8,
        paddingVertical: 2,
      }}>
      <Text style={{ color: colors.gold, fontSize: 11, fontWeight: '700' }}>Владелец</Text>
    </View>
  );
}
