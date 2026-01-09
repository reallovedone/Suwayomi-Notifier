# Suwayomi Notifier

Telegram Notifier for [Suwayomi / Tachidesk](https://github.com/Suwayomi/Suwayomi-Server) that sends a message whenever a new manga chapter is detected.

Works through WebSocket + GraphQL subscriptions, with state persistence to avoid duplicate notifications.

---

## 🚀 Features

- Real-time Telegram notifications
- Automatic login to Suwayomi
- Automatic WebSocket reconnection
- State persistence via `state.json`
- No duplicate notifications
- Docker-friendly

---

## 📦 Requirements

- Docker
- Docker Compose
- Suwayomi instance reachable from the container
- Telegram Bot + Chat ID

---

## ⚠️ Important — Enable Automatic Updates in Suwayomi

For the notifier to work correctly, **Suwayomi must be configured to automatically update the library**.

In Suwayomi:

```
Settings → Library → Global update
```

Enable:

- **Automatic Updates**
- Set an **Automatic Update interval**

Without this, Suwayomi will not detect new chapters, and no notifications will be sent.

---

## 🐳 Running with Docker Compose

Example `docker-compose.yml`:

```yaml
services:
  suwayomi-notifier:
    image: ghcr.io/reallovedone/suwayomi-notifier:latest
    container_name: suwayomi-notifier
    environment:
      SUWAYOMI_HTTP: "http://suwayomi:4567"
      SUWAYOMI_WS: "ws://suwayomi:4567/api/graphql"
      SUWAYOMI_USERNAME: "USERNAME"
      SUWAYOMI_PASSWORD: "PASSWORD"
      TELEGRAM_TOKEN: "TELEGRAM_TOKEN"
      TELEGRAM_CHAT_ID: "TELEGRAM_CHAT_ID"
      STATE_FILE: "/app/state/state.json"
    volumes:
      - ./state:/app/state
    restart: unless-stopped
```

> Note: If Suwayomi runs in Docker on the same network, it can be reached as `http://suwayomi:4567`.

Start:

```bash
docker-compose up -d
```

Stop:

```bash
docker-compose down
```

---

## 📁 Project Structure

```text
suwayomi-notifier/
  docker-compose.yml
  Dockerfile
  package.json
  package-lock.json
  src/
    watcher.js
  state/
    .gitkeep
  .env.example
  .gitignore
  LICENSE
  README.md
```

---

## 📝 Operational Notes

- `state.json` is generated at runtime (do not commit it).
- On first startup, **no notifications are sent**: the current state is stored as baseline.
- If the state is deleted, a new baseline will be created on next startup.
- The WebSocket automatically reconnects if it drops or if the token expires.

---

## 👤 Author

Maintainer: **reallovedone**

Contributions and PRs are welcome ✨

---

## 📄 License

This project is distributed under the **ISC** license.  
See the `LICENSE` file for details.
