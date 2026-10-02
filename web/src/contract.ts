/**
 * Client-side preview of the join contract template (SPEC §3).
 *
 * The server snapshots the authoritative `contract_text` when an application
 * is created; this builder renders the SAME template so the catalog modal can
 * show a scrollable contract before submitting (SPEC v2 §14.2 — there is no
 * separate "template preview" endpoint in the SPEC).
 */

function dateStr(ts: number): string {
  return new Date(ts).toLocaleDateString('ru-RU');
}

/** Exact join-contract template from SPEC §3 (org + role filled at build). */
export function buildJoinContract(orgName: string, roleLabel: string, at = Date.now()): string {
  return `ДОГОРОР О ПРИСОЕДИНЕНИИ К ОРГАНИЗАЦИИ «${orgName}»

Я, нижеподписавшийся(яся) ______________ (ФИО), через настоящее соглашение
подтверждаю своё добровольное присоединение к организации «${orgName}»
в роли «${roleLabel}».

1. Я ознакомился(лась) с правилами организации и обязуюсь их соблюдать.
2. Я получаю доступ к внутренним каналам связи, чатам и звонкам организации.
3. Я согласен(на) на обработку данных, необходимых для работы внутри организации.
4. Настоящий договор вступает в силу с момента подписания и может быть
   расторгнут мною в любой момент через выход из организации.

Дата подписи: ${dateStr(at)}
Роль: ${roleLabel}

Подпись: {signature image is appended by the app after drawing}`;
}
