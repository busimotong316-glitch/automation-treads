# README - Iman WhatsApp Bot

Ini adalah WhatsApp bot yang bridge ke n8n webhook dengan Drizzle ORM untuk PostgreSQL/Supabase.

## 🚀 Fitur

- ✅ WhatsApp message listener menggunakan Baileys
- ✅ Message history saved ke Supabase PostgreSQL
- ✅ n8n webhook integration dengan retry logic
- ✅ Robust error handling & graceful shutdown
- ✅ Memory leak prevention dengan proper cleanup
- ✅ Docker-ready dengan docker-compose
- ✅ Environment variable configuration
- ✅ Proper logging dengan colors

## 📋 Prerequisite

- Node.js 18+
- PostgreSQL database (Supabase)
- n8n instance (Docker recommended)
- Docker & Docker Compose (untuk containerized setup)

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

3. **Edit .env dengan credentials:**

```env
DATABASE_URL=postgresql://user:password@host:5432/db
N8N_WEBHOOK_URL=http://localhost:5678/webhook/messages
```

4. **Run development:**

```bash
npm run dev
```

### Docker Setup

1. **Build image:**

```bash
npm run build:docker
```

atau langsung:

```bash
docker-compose up --build
```

2. **Access n8n:**

- URL: http://localhost:5678
- Username: admin
- Password: password

3. **Setup n8n webhook:**

- Create new workflow
- Add Webhook node
- Set URL: `/webhook/messages`
- Listen untuk POST requests
- Payload akan ada: `remoteJid`, `pushName`, `content`, `timestamp`

## 📝 Environment Variables

| Variable              | Description                       | Default                                |
| --------------------- | --------------------------------- | -------------------------------------- |
| `DATABASE_URL`        | PostgreSQL connection string      | Required                               |
| `N8N_WEBHOOK_URL`     | n8n webhook endpoint              | http://localhost:5678/webhook/messages |
| `N8N_WEBHOOK_TIMEOUT` | Webhook timeout (ms)              | 10000                                  |
| `N8N_WEBHOOK_RETRIES` | Retry attempts kalau webhook fail | 3                                      |
| `BOT_NAME`            | Bot display name                  | Iman Bot                               |
| `BOT_RECONNECT_DELAY` | Delay sebelum reconnect (ms)      | 5000                                   |
| `LOG_LEVEL`           | Log level                         | info                                   |

## 🏗️ Architecture

```
WhatsApp Message
    ↓
┌─────────────────────┐
│  Baileys Handler    │ (Listen incoming messages)
└─────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  processMessage() - Parallel Processing │
├─────────────────────────────────────────┤
│  ├→ Save to Supabase PostgreSQL          │
│  └→ Send to n8n Webhook (with retry)    │
└─────────────────────────────────────────┘
    ↓
✅ Done (logging + error handling)
```

## 🔄 Retry Logic

n8n webhook gunakan exponential backoff:

- Attempt 1: immediate
- Attempt 2: 1 second delay
- Attempt 3: 2 seconds delay
- Max: 10 seconds

Kalau semua gagal, bot tetap jalan (nggak crash), dan error di-log.

## 🧹 Memory Management

- ✅ Event listeners di-cleanup dengan `removeAllListeners()`
- ✅ Reconnect timeout di-clear sebelum reconnect baru
- ✅ Graceful shutdown dengan SIGINT/SIGTERM handlers
- ✅ Connection pooling untuk database
- ✅ Proper resource cleanup on exit

## 🐛 Troubleshooting

### Bot reconnect terus

- Delete `auth_info_baileys` folder
- Session mungkin login di tempat lain (WhatsApp Web / device lain)
- Check error code di logs

### n8n webhook nggak diterima

- Pastikan URL accessible dari bot container
- Check n8n logs: `docker logs n8n`
- Verify webhook configuration di n8n

### Database connection timeout

- Check DATABASE_URL di .env
- Verify Supabase credentials
- Check firewall/network rules

### High memory usage

- Check logs untuk memory leak indicators
- Verify event listeners di-cleanup properly
- Monitor dengan: `docker stats`

## 📊 Database Schema

```sql
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  remote_jid TEXT NOT NULL,
  push_name TEXT,
  content TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## 🚢 Deployment

### Using docker-compose (Recommended)

```bash
docker-compose up -d
```

Monitor logs:

```bash
docker-compose logs -f iman_bot
```

Stop:

```bash
docker-compose down
```

### Using standalone Docker

```bash
docker build -t iman-wa-bot .

docker run -d \
  --name iman_bot \
  -e DATABASE_URL="postgresql://..." \
  -e N8N_WEBHOOK_URL="http://n8n:5678/webhook/messages" \
  -v ./auth_info_baileys:/app/auth_info_baileys \
  iman-wa-bot
```

## 📄 License

ISC

## 👨‍💻 Author

Iman Bot - WhatsApp Bridge for n8n
