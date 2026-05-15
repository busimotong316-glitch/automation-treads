# Iman WhatsApp Bot - n8n Bridge

A robust WhatsApp bot that serves as a bridge to n8n webhooks, built with Baileys and Drizzle ORM for PostgreSQL/Supabase persistence.

## 🚀 Features

- ✅ **WhatsApp Listener:** Real-time message listening using Baileys.
- ✅ **Supabase Integration:** Automatic message history logging to PostgreSQL.
- ✅ **n8n Webhook Bridge:** Seamless integration with n8n workflows.
- ✅ **Media Support:** Extracts and sends images as Base64 to webhooks.
- ✅ **Owner Whitelisting:** Secure filtering to respond only to your personal number.
- ✅ **Anti-Ban Humanizing:** Simulated typing indicators for safer interactions.
- ✅ **Retry Logic:** Exponential backoff for webhook delivery failures.
- ✅ **Docker Ready:** Fully containerized with docker-compose.
- ✅ **Graceful Shutdown:** Proper cleanup of database and socket connections.

## 📋 Prerequisites

- Node.js 18+
- PostgreSQL database (Supabase recommended)
- n8n instance (Docker recommended)
- Docker & Docker Compose (for containerized setup)

## 🔧 Setup

### Local Development

1. **Install dependencies:**

```bash
npm install
```

2. **Create .env file:**

```bash
cp .env.example .env
```

3. **Configure environment variables:**

```env
DATABASE_URL=postgresql://user:password@host:6543/postgres
N8N_WEBHOOK_URL=http://localhost:5678/webhook/messages
OWNER_NUMBER=62812...
```

4. **Run development mode:**

```bash
npm run dev
```

### Docker Setup (Recommended)

1. **Build and start containers:**

```bash
docker-compose up -d --build
```

2. **Access n8n:**

- URL: http://localhost:5678
- Default Credentials: `admin` / `password` (configurable in docker-compose.yml)

3. **Monitor logs & Scan QR:**

```bash
docker logs -f iman_wa_bot
```

## 📝 Environment Variables

| Variable              | Description                              | Default                                |
| --------------------- | ---------------------------------------- | -------------------------------------- |
| `DATABASE_URL`        | PostgreSQL connection string (IPv4)      | Required                               |
| `N8N_WEBHOOK_URL`     | n8n webhook endpoint                     | http://n8n:5678/webhook/messages       |
| `OWNER_NUMBER`        | Your personal WA number (Whitelisting)   | Required                               |
| `N8N_WEBHOOK_TIMEOUT` | Webhook timeout (ms)                     | 10000                                  |
| `N8N_WEBHOOK_RETRIES` | Retry attempts if webhook fails          | 3                                      |
| `BOT_NAME`            | Bot display name                         | Iman Bot                               |
| `LOG_LEVEL`           | Log level (debug, info, warn, error)     | info                                   |

## 🏗️ Architecture

```
WhatsApp Message (from Owner)
    ↓
┌─────────────────────┐
│  Baileys Handler    │ (Listen & Media Extraction)
└─────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  processMessage() - Parallel Processing │
├─────────────────────────────────────────┤
│  ├→ Save to Supabase PostgreSQL          │
│  └→ Send to n8n Webhook (Base64 Image)   │
└─────────────────────────────────────────┘
    ↓
✅ Confirmation Reply sent to User
```

## 🔄 Webhook Retry Logic

The bot uses exponential backoff for failed webhook requests:

- Attempt 1: Immediate
- Attempt 2: 1-second delay
- Attempt 3: 2-seconds delay

If all attempts fail, the bot logs the error but continues running to process next messages.

## 🧹 Memory & Resource Management

- ✅ Event listeners are cleaned up using `removeAllListeners()`.
- ✅ Reconnection timeouts are cleared before new attempts.
- ✅ Graceful shutdown handled via SIGINT/SIGTERM.
- ✅ Connection pooling used for database efficiency.

## 🐛 Troubleshooting

### Bot keeps reconnecting

- Delete the `auth_info_baileys` folder and scan the QR code again.
- Ensure the session isn't active on too many other devices.

### Webhook not received in n8n

- Check if the n8n container is accessible from the bot container.
- Verify the Webhook path in n8n matches `/webhook/messages`.
- Check n8n logs: `docker logs n8n`.

### Database connection error (ENETUNREACH)

- Ensure you are using the **IPv4 Transaction Pooler** URL from Supabase (Port 6543).
- Docker Alpine environments may have issues resolving IPv6.

## 📄 License

ISC

## 👨‍💻 Author

**Iman Bot** - WhatsApp Bridge for n8n Automation
