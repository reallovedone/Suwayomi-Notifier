# Suwayomi Notifier

Notifier for [Suwayomi / Tachidesk](https://github.com/Suwayomi/Suwayomi-Server) that sends notifications whenever new manga chapters are detected.

Works through WebSocket + GraphQL subscriptions, with state persistence to avoid duplicate notifications.

---

## 🚀 Features

- Real-time notifications via [Apprise](https://github.com/caronc/apprise-api)
- Supports tons of destinations (Telegram, Discord, Webhooks, Slack, Email, etc.)
- Automatic login to Suwayomi
- Automatic WebSocket reconnection
- State persistence via `state.json`
- No duplicate notifications
- Docker-friendly

---

## 🔔 About [Apprise](https://github.com/caronc/apprise-api)

This project uses Apprise for notification delivery.

Apprise provides a unified way to send notifications to hundreds of services using simple URL-style identifiers.

Popular examples:

- Telegram: `tgram://TOKEN/CHAT_ID`
- Discord: `discord://WEBHOOK_ID/WEBHOOK_TOKEN`
- Slack: `slack://TOKEN/CHANNEL`
- Email: `mailto://user:pass@smtp.example.com`
- Webhooks: `json://endpoint.example.com/webhook`

You can configure multiple targets and formats, and optionally route by tags.

---

## 📦 Requirements

- Docker
- Docker Compose
- Suwayomi instance reachable from the container
- Apprise API endpoint (`apprise-api` docker image)

---

## ⚠️ Important — Enable Automatic Updates in Suwayomi

For notifications to work, Suwayomi must be configured to automatically update the library.

In Suwayomi:

Settings → Library → Global update

Enable:

- Automatic Updates
- Pick an Automatic Update interval

Without this, Suwayomi will not detect new chapters, and no notifications will be sent.

---

## 🐳 Running with Docker Compose

Example `docker-compose.yml`:

services:
  suwayomi-notifier:
    image: ghcr.io/reallovedone/suwayomi-notifier:latest
    container_name: suwayomi-notifier
    environment:
      SUWAYOMI_HTTP: "http://suwayomi:4567"
      SUWAYOMI_WS: "ws://suwayomi:4567/api/graphql"
      SUWAYOMI_USERNAME: "USERNAME"
      SUWAYOMI_PASSWORD: "PASSWORD"

      APPRISE_API_URL: "http://apprise-api:8000"
      APPRISE_TARGET: "tgram://TOKEN/CHAT_ID"
      APPRISE_TAGS: "suwayomi"
      APPRISE_FORMAT: "text"

      STATE_FILE: "/app/state/state.json"
    volumes:
      - ./state:/app/state
    restart: unless-stopped

Note: If Suwayomi runs in Docker on the same network, it can be reached as `http://suwayomi:4567`.

Start:
docker-compose up -d

Stop:
docker-compose down

---

## 📁 Project Structure

suwayomi-notifier/
  docker-compose.yml
  Dockerfile
  package.json
  package-lock.json
  src/
    watcher.js
  state/
  .env.example
  .gitignore
  LICENSE
  README.md

---

## 📝 Operational Notes

- `state.json` is generated at runtime (do not commit it).
- On first startup, no notifications are sent: the current state is stored as baseline.
- If the state is deleted, a new baseline will be created on next startup.
- The WebSocket automatically reconnects if it drops or if the token expires.

---

## 👤 Author

Maintainer: reallovedone

Contributions and PRs are welcome ✨

---

## 📄 License

This project is distributed under the ISC license.
See the LICENSE file for details.
