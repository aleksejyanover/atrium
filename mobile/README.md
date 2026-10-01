# Atrium — мобильное приложение (`mobile/`)

Тёмное, минимальное приложение-мессенджер для организаций. Экраны, ролевая
матрица, REST и Socket.IO-протокол описаны в корневом `SPEC.md`.

## Стек

- **Expo SDK 57** (React Native 0.86, React 19), TypeScript
- **expo-router** — файловый роутинг (`src/app/`)
- **socket.io-client** — реалтайм (сообщения, typing, presence, звонки)
- **react-native-webrtc** — видеозвонки 1:1 (сигналинг через сервер)
- **react-native-svg** — pad ручной подписи
- **@react-native-async-storage/async-storage** — хранение токена
- **@expo/vector-icons** (Feather) — иконки

## Требования

- Node **v20.20.2** (`export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`)
- Запущенный бэкенд: `cd ../server && npm i && npm run dev` (порт **4000**)
- `npm install` в этой папке

## Запуск

Адрес API задаётся переменной `EXPO_PUBLIC_API_URL`
(по умолчанию `http://localhost:4000`).

**Важно:** на физическом телефоне `localhost` — это сам телефон, поэтому
указывайте LAN-IP вашей машины:

```bash
# macOS: узнать свой LAN-IP
ipconfig getifaddr en0

# запуск dev-сервера с адресом API
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
cd mobile
npm install
EXPO_PUBLIC_API_URL=http://192.168.1.5:4000 npx expo start
```

То же самое можно записать в файл `.env` (он в `.gitignore`):

```
EXPO_PUBLIC_API_URL=http://192.168.1.5:4000
```

Дальше отсканируйте QR-код в приложении **Expo Go** (смартфон должен быть в
той же Wi-Fi-сети) или нажмите `i` / `a` для iOS/Android симулятора.

- На iOS-симуляторе и в вебе `http://localhost:4000` работает без изменений.
- Убедитесь, что сервер доступен с телефона: `curl http://<LAN-IP>:4000/api/health`.

## Звонки и нативный модуль react-native-webrtc

`react-native-webrtc` содержит **нативный код**, поэтому он **не входит в Expo Go**
(см. README upstream-проекта). В Expo Go работают авторизация, организации,
чаты, приглашения и подписание договора, а видеозвонки — только в
**development build**:

```bash
# локальная сборка (нужны Android Studio / Xcode)
npx expo run:android
npx expo run:ios

# либо облачная сборка через EAS
npx eas-cli build --profile development
```

После такой сборки открывайте приложение уже не через Expo Go, а через
установленный dev-build (Expo Dev Client подхватит Metro автоматически).

Настройки прав в `app.json`:

- плагин `@config-plugins/react-native-webrtc` — `NSCameraUsageDescription` и
  `NSMicrophoneUsageDescription` для iOS, а также разрешения
  `CAMERA` / `RECORD_AUDIO` (и остальные из README модуля) для Android;
- `userInterfaceStyle: "dark"` — приложение тёмное только.

Сигналинг полностью соответствует SPEC (раздел 4): `call:invite/accept/reject/leave`,
ретрансляция `rtc:sdp` / `rtc:ice`, `call:state` (микрофон/камера),
`presence:update` (зелёные точки в списке ЛС), `invite:new`
(бейдж + всплывающее уведомление с переходом к договору).

## Подпись в договоре (техническое примечание)

В React Native нет `<canvas>`, поэтому подпись рисуется через
`PanResponder` + `react-native-svg` (массив штрихов → SVG `<path>`), а на сервер
отправляется `data:image/svg+xml;base64,...` — строки штрихов, сериализованные
в SVG-документ и закодированные в base64. API требует только того, чтобы
значение начиналось с `data:image/`, поэтому контракт соблюдён.
Если на сервере понадобится именно PNG — конвертация должна происходить
на стороне бэкенда или через нативный модуль рендеринга.

## Структура

```
src/
  app/                 маршруты (expo-router)
    _layout.tsx        провайдеры (auth, socket, orgs, toast, calls) + Stack
    login.tsx          /login
    register.tsx       /register
    (app)/index.tsx    /          — выбор организации
    (app)/org/[id].tsx /org/:id   — вкладки Чаты / Участники / Приглашения
    (app)/chat/[channelId].tsx    — чат (история, typing, звонки)
    (app)/contract/[inviteId].tsx — договор + pad подписи
  components/          UI (Avatar, RoleBadge, модалки, SignaturePad, звонки)
  lib/                 API, типы, роли/разрешения, подпись, формат дат
  state/               контексты: auth, socket, orgs, call (WebRTC), toast
```

## Проверка

```bash
npx tsc --noEmit   # 0 ошибок
npx expo-doctor    # диагностика конфигурации и зависимостей
```

## Ограничения

- Звонки только 1:1, без канала (STUN `stun.l.google.com:19302`, **нет TURN** —
  соединение может не установиться за жёстким NAT/симметричным файрволом).
- Нет загрузки файлов, только текстовые сообщения.
- Список онлайна обновляется по событиям `presence:update`.
