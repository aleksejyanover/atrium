/**
 * Permission matrix helpers (SPEC §2, updated by SPEC v3 §19).
 * actor = acting member row {role}, target = another member row {role}.
 */
import { rankOf, forbidden, conflict } from './util.js'

export const canInvite = (actorRank) => actorRank >= 40
export const canCreateChannel = (actorRank) => actorRank >= 40
export const canEditOrg = (actorRank) => actorRank >= 60
export const canViewInvites = (actorRank) => actorRank >= 40
// SPEC v3 §19: assistant_admin (rank ≥ 40) may delete other people's messages
export const canDeleteAnyMessage = (actorRank) => actorRank >= 40
// SPEC v3 §19: dismissals (create) & one-sided termination — admin and above
export const canDismiss = (actorRank) => actorRank >= 60
export const canTerminate = (actorRank) => actorRank >= 60
// applications staff side (§12: rank ≥ 40)
export const canReviewApplications = (actorRank) => actorRank >= 40

/** Change role of target: owner → any target except owner;
 *  otherwise actor.rank > target.rank AND newRole.rank < actor.rank.
 *  SPEC v5 §29: `targetIsOwner` (card owner, is_owner) may be assigned the
 *  `owner` role — the «role owner is not assignable» rule applies only to
 *  regular users; the rank ceiling is not applied to that specific case. */
export function canChangeRole(actorRole, targetRole, newRole, targetIsOwner = false) {
  const assigningOwner = newRole === 'owner'
  if (actorRole === 'owner') {
    if (targetRole === 'owner' && !(targetIsOwner && assigningOwner)) {
      throw forbidden('Нельзя изменить роль владельца')
    }
    return true
  }
  const a = rankOf(actorRole)
  const t = rankOf(targetRole)
  if (a <= t) throw forbidden('Недостаточно прав для изменения роли этого участника')
  // §29: card owner can be made an owner regardless of the «newRole < actor.rank» rule
  if (targetIsOwner && assigningOwner) return true
  const n = rankOf(newRole)
  if (n >= a) throw forbidden('Нельзя назначить роль выше или равную вашей')
  return true
}

/** Remove target from org: owner → anyone except owner; else actor.rank > target.rank. */
export function canRemoveMember(actorRole, targetRole) {
  if (actorRole === 'owner') {
    if (targetRole === 'owner') throw conflict('Владелец не может быть исключён. Передайте владение или покиньте организацию.')
    return true
  }
  if (rankOf(actorRole) <= rankOf(targetRole)) {
    throw forbidden('Недостаточно прав для исключения этого участника')
  }
  return true
}

/** Cancel pending invite: inviter self, or owner, or rank ≥ 60. */
export function canCancelInvite(actor, invite) {
  if (invite.inviter_id === actor.userId) return true
  if (actor.role === 'owner') return true
  if (rankOf(actor.role) >= 60) return true
  throw forbidden('Недостаточно прав для отмены этого приглашения')
}
