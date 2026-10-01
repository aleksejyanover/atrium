import { Role } from '@/lib/types';

/** Ranks come from SPEC.md section 2 (permission matrix). */
export const ROLE_RANK: Record<Role, number> = {
  owner: 100,
  assistant_owner: 80,
  admin: 60,
  assistant_admin: 40,
  member: 20,
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Владелец',
  assistant_owner: 'Помощник владельца',
  admin: 'Админ',
  assistant_admin: 'Помощник админа',
  member: 'Участник',
};

/** Ordered from highest rank to lowest — used for role pickers. */
export const ROLES_DESC: Role[] = [
  'owner',
  'assistant_owner',
  'admin',
  'assistant_admin',
  'member',
];

export function rankOf(role: Role | null | undefined): number {
  return role ? ROLE_RANK[role] : 0;
}

/** Invite user to org — rank ≥ 40. */
export function canInvite(role: Role | null | undefined): boolean {
  return rankOf(role) >= 40;
}

/** Create channel — rank ≥ 40. */
export function canCreateChannel(role: Role | null | undefined): boolean {
  return rankOf(role) >= 40;
}

/** View pending invites of org — rank ≥ 40. */
export function canViewOrgInvites(role: Role | null | undefined): boolean {
  return rankOf(role) >= 40;
}

/**
 * Change role of target:
 * owner → any target except owner; otherwise actor.rank > target.rank
 * AND newRole.rank < actor.rank.
 */
export function canChangeRole(actorRole: Role, targetRole: Role, newRole: Role): boolean {
  if (actorRole === 'owner') return targetRole !== 'owner' && newRole !== 'owner';
  return (
    rankOf(actorRole) > rankOf(targetRole) && rankOf(newRole) < rankOf(actorRole)
  );
}

/** Roles the actor may assign (depends on target for non-owners). */
export function assignableRoles(actorRole: Role, targetRole: Role): Role[] {
  return ROLES_DESC.filter((r) => canChangeRole(actorRole, targetRole, r));
}

/** Roles the actor may use when inviting someone (no target yet). */
export function invitableRoles(actorRole: Role): Role[] {
  if (actorRole === 'owner') return ROLES_DESC.filter((r) => r !== 'owner');
  return ROLES_DESC.filter((r) => rankOf(r) < rankOf(actorRole));
}

/** Remove target from org: owner → anyone except owner; else actor.rank > target.rank. */
export function canRemoveMember(actorRole: Role, targetRole: Role): boolean {
  if (actorRole === 'owner') return targetRole !== 'owner';
  return rankOf(actorRole) > rankOf(targetRole);
}

/** Leave org (self) — anyone except owner. */
export function canLeaveOrg(role: Role | null | undefined): boolean {
  return role !== 'owner';
}

/** Cancel pending invite — inviter self, or owner, or rank ≥ 60. */
export function canCancelInvite(
  actorRole: Role | null | undefined,
  actorUserId: string,
  inviterId: string | null | undefined,
): boolean {
  if (inviterId && inviterId === actorUserId) return true;
  if (actorRole === 'owner') return true;
  return rankOf(actorRole) >= 60;
}

/** Delete any message — author, or rank ≥ 60. */
export function canDeleteMessage(
  actorRole: Role | null | undefined,
  actorUserId: string,
  authorId: string,
): boolean {
  if (authorId === actorUserId) return true;
  return rankOf(actorRole) >= 60;
}
