/**
 * Permission matrix from SPEC §2 — client-side helpers used to show/hide UI.
 * The server enforces the same rules; these only shape the interface.
 */

import { ALL_ROLES, roleRank, type Role } from './types';

export interface Actor {
  id: string;
  role: Role;
}

export const actorRank = (actor: Actor): number => roleRank(actor.role);

/** Invite user to org — rank ≥ 40. */
export const canInvite = (rank: number): boolean => rank >= 40;

/** Create channel — rank ≥ 40. */
export const canCreateChannel = (rank: number): boolean => rank >= 40;

/** Edit org (name/description) — rank ≥ 60. */
export const canEditOrg = (rank: number): boolean => rank >= 60;

/** View pending invites of org — rank ≥ 40. */
export const canViewOrgInvites = (rank: number): boolean => rank >= 40;

/** Leave org (self) — anyone except owner. */
export const canLeaveOrg = (actor: Actor): boolean => actor.role !== 'owner';

/** Delete any message — author, or rank ≥ 60. */
export const canDeleteMessage = (senderId: string, actor: Actor): boolean =>
  senderId === actor.id || actorRank(actor) >= 60;

/** Cancel pending invite — inviter self, or owner, or rank ≥ 60. */
export const canCancelInvite = (actor: Actor, inviterId: string | null): boolean =>
  (inviterId !== null && inviterId === actor.id) || actorRank(actor) >= 60;

/**
 * Change role of target — owner → any target except owner;
 * otherwise actor.rank > target.rank AND newRole.rank < actor.rank.
 * (The owner branch collapses into the same formula: rank 100 > any non-owner
 * target, and no role but owner itself has rank < 100.)
 */
export const canChangeRole = (actor: Actor, targetRole: Role, newRole: Role): boolean => {
  if (targetRole === 'owner') return false;
  if (newRole === targetRole) return false;
  return (
    actorRank(actor) > roleRank(targetRole) && roleRank(newRole) < actorRank(actor)
  );
};

/** Roles the actor may assign to this target (never owner, never current). */
export const assignableRoles = (actor: Actor, targetRole: Role): Role[] =>
  ALL_ROLES.filter((r) => canChangeRole(actor, targetRole, r));

/**
 * Remove target from org — owner → anyone except owner; else actor.rank > target.rank.
 * Self-removal (leave) is always allowed and handled by the leave endpoint.
 */
export const canRemoveMember = (
  actor: Actor,
  target: { id: string; role: Role },
): boolean => {
  if (target.id === actor.id) return true;
  if (target.role === 'owner') return false;
  return actorRank(actor) > roleRank(target.role);
};
