import { roleLabel } from './util.js'

/** Format timestamp as DD.MM.YYYY */
function formatDate(ts) {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mm}.${d.getFullYear()}`
}

/**
 * Contract template (SPEC §3) — filled at invite creation and snapshotted
 * into invites.contract_text.
 */
export function buildContractText({ orgName, role, createdAt }) {
  const label = roleLabel(role)
  return `ДОГОРОР О ПРИСОЕДИНЕНИИ К ОРГАНИЗАЦИИ «${orgName}»

Я, нижеподписавшийся(яся) ______________ (ФИО), через настоящее соглашение
подтверждаю своё добровольное присоединение к организации «${orgName}»
в роли «${label}».

1. Я ознакомился(лась) с правилами организации и обязуюсь их соблюдать.
2. Я получаю доступ к внутренним каналам связи, чатам и звонкам организации.
3. Я согласен(на) на обработку данных, необходимых для работы внутри организации.
4. Настоящий договор вступает в силу с момента подписания и может быть
   расторгнут мною в любой момент через выход из организации.

Дата подписи: ${formatDate(createdAt)}
Роль: ${label}

Подпись: {signature image is appended by the app after drawing}
`
}

/**
 * Dismissal contract template (SPEC §11) — filled at dismissal creation and
 * snapshotted into documents.contract_text.
 * `reason` defaults: «по собственному желанию» when the employee initiated it
 * themselves, otherwise «по инициативе организации».
 */
export function buildDismissalContractText({ orgName, role, reason, initiatedByTarget, createdAt }) {
  const label = roleLabel(role)
  const filledReason =
    (typeof reason === 'string' && reason.trim()) ||
    (initiatedByTarget ? 'по собственному желанию' : 'по инициативе организации')
  return `ДОГОВОР ОБ УВОЛЬНЕНИИ ИЗ ОРГАНИЗАЦИИ «${orgName}»

Я, нижеподписавшийся(яся) ______________ (ФИО), настоящим подтверждаю
прекращение моего участия в организации «${orgName}» в роли «${label}».

Причина: ${filledReason}

1. С моего участия в организация снимаются все обязательства, связанные
   с доступом к каналам, чатам и звонкам организации.
2. Доступ к внутренним ресурсам организации прекращается с момента подписи.
3. Настоящий договор вступает в силу с момента подписи и является окончательным.

Дата: ${formatDate(createdAt)}
Роль: ${label}

Подпись: {изображение подписи добавляется приложением после отрисовки}
`
}
