# Suwayomi Notifier

Notifier Telegram per [Suwayomi / Tachidesk](https://github.com/Suwayomi) che invia un messaggio ogni volta che viene rilevato un nuovo capitolo manga.

Funziona tramite WebSocket + GraphQL subscription, con salvataggio dello stato per evitare notifiche duplicate.

---

## 🚀 Funzionalità

- Notifiche Telegram in tempo reale
- Login automatico verso Suwayomi
- Riconnessione automatica al WebSocket
- Salvataggio dello stato su `state.json`
- Nessuna notifica duplicata
- Pensato per funzionare in Docker

---

## 📦 Requisiti

- Docker
- Docker Compose
- Istanza Suwayomi raggiungibile dal container
- Bot Telegram + Chat ID

---

## ⚙️ Configurazione

Crea un file `.env` (opzionale) con:

```env
SUWAYOMI_HTTP=http://suwayomi:4567
SUWAYOMI_WS=ws://suwayomi:4567/api/graphql
SUWAYOMI_USERNAME=<username>
SUWAYOMI_PASSWORD=<password>
TELEGRAM_TOKEN=<token del bot telegram>
TELEGRAM_CHAT_ID=<chat id telegram>
STATE_FILE=/app/state/state.json
```

> Nota: se Suwayomi gira su Docker nella stessa network, puoi raggiungerlo come `http://suwayomi:4567`.

---

## 🐳 Esecuzione con Docker Compose

Esempio di `docker-compose.yml`:

```yaml
services:
  suwayomi-notifier:
    build: .
    container_name: suwayomi-notifier
    env_file:
      - .env
    volumes:
      - ./state:/app/state
    restart: unless-stopped
```

Avvio:

```bash
docker-compose up -d
```

Stop:

```bash
docker-compose down
```

---

## 📁 Struttura del progetto

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

## 📝 Note Operative

- Il file `state.json` viene generato in runtime (non committarlo).
- Al primo avvio **non invia notifiche**: registra solo lo stato attuale.
- Se lo stato viene cancellato → al successivo avvio crea un nuovo baseline.
- Riconnette automaticamente il WebSocket se cade o se scade il token.

---

## 👤 Autore

Maintainer: reallovedone

Contributi e PR benvenuti ✨

---

## 📄 Licenza

Questo progetto è distribuito sotto licenza **ISC**.  
Vedi il file `LICENSE` per maggiori dettagli.