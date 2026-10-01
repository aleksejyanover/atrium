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
