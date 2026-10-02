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
 * Change role of target (SPEC §19): owner/assistant_owner/admin only;
 * owner → any target except owner; otherwise actor.rank > target.rank
 * AND newRole.rank < actor.rank (admin — только роли ниже своей).
 */
export function canChangeRole(actorRole: Role, targetRole: Role, newRole: Role): boolean {
  if (rankOf(actorRole) < 60) return false;
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

/** Delete any message — author, or rank ≥ 40 (SPEC §19: помощник админа и выше). */
export function canDeleteMessage(
  actorRole: Role | null | undefined,
  actorUserId: string,
  authorId: string,
): boolean {
  if (authorId === actorUserId) return true;
  return rankOf(actorRole) >= 40;
}

/** Принимать/отклонять заявления — rank ≥ 40 (SPEC §19). */
export function canReviewApplications(role: Role | null | undefined): boolean {
  return rankOf(role) >= 40;
}

/** Просмотр заявок/увольнений орг. — rank ≥ 40 (SPEC §19). */
export function canReviewDismissals(role: Role | null | undefined): boolean {
  return rankOf(role) >= 40;
}

/** Увольнять (dismissal), односторонний разрыв: owner/assistant_owner/admin (SPEC §19). */
export function canDismiss(
  actorRole: Role | null | undefined,
  targetRole: Role | null | undefined,
): boolean {
  if (rankOf(actorRole) < 60) return false;
  if (targetRole === 'owner') return false;
  return rankOf(actorRole) > rankOf(targetRole);
}

/** Расторгнуть в одностороннем порядке — тот же круг, что и увольнение (SPEC §19). */
export function canTerminate(
  actorRole: Role | null | undefined,
  targetRole: Role | null | undefined,
): boolean {
  return canDismiss(actorRole, targetRole);
}

/** Редактировать организацию и публичность — rank ≥ 60 (SPEC §19). */
export function canEditOrg(role: Role | null | undefined): boolean {
  return rankOf(role) >= 60;
}

/** Просмотр истории действий — любой участник (SPEC §19). */
export function canViewActivity(): boolean {
  return true;
}

// ---- Матрица прав (SPEC §19) ----------------------------------------------

export interface RoleMatrixRow {
  key: string;
  label: string;
  note?: string;
  allowed: Record<Role, boolean>;
}

function matrixRow(
  key: string,
  label: string,
  roles: Role[],
  note?: string,
): RoleMatrixRow {
  const allowed: Record<Role, boolean> = {
    owner: false,
    assistant_owner: false,
    admin: false,
    assistant_admin: false,
    member: false,
  };
  for (const role of roles) allowed[role] = true;
  return { key, label, note, allowed };
}

const STAFF: Role[] = ['owner', 'assistant_owner', 'admin', 'assistant_admin'];
const SENIOR: Role[] = ['owner', 'assistant_owner', 'admin'];
const EVERYONE: Role[] = ['owner', 'assistant_owner', 'admin', 'assistant_admin', 'member'];

/** Таблица «Роли и права» (SPEC §19) — строки действий × роли. */
export const ROLE_MATRIX: RoleMatrixRow[] = [
  matrixRow('invite', 'Приглашать участников', STAFF),
  matrixRow('applications', 'Принимать и отклонять заявления', STAFF),
  matrixRow('channels', 'Создавать каналы', STAFF),
  matrixRow('messages', 'Удалять любые сообщения', STAFF),
  matrixRow('dismiss', 'Увольнять (договор об увольнении)', SENIOR),
  matrixRow('terminate', 'Расторгать договор в одностороннем порядке', SENIOR),
  matrixRow('roles', 'Менять роли', SENIOR, 'Админ назначает только роли ниже своей'),
  matrixRow('org', 'Редактировать организацию и публичность', SENIOR),
  matrixRow('documents', 'Просматривать заявки и увольнения', STAFF),
  matrixRow('activity', 'Просматривать историю действий', EVERYONE),
  matrixRow('chat', 'Чаты, звонки, каталог и подача заявлений', EVERYONE),
];
