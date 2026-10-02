/**
 * Золотая пилюля «Владелец» — рядом с любым пользователем, у которого есть
 * карточка владельца (`user.isOwner`, SPEC v5 §29.4 / §30).
 */

export function OwnerBadge() {
  return <span className="owner-badge">Владелец</span>;
}
