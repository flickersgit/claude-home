# Mochi 🧋 — WhatsApp → Claude Code Bridge

Mochi is a WhatsApp bot that lets you instruct Claude Code to create or edit games from your phone. Message Mochi, get a plan, confirm, and it builds + deploys automatically.

---

## Prerequisites

- Mochi's WhatsApp account on a **second SIM or VoIP number** (not your personal number)
- Node.js (v18+) — already installed
- `wrangler` — already installed
- `pm2` — install globally if not already: `npm install -g pm2`

---

## Setup (first time)

### 1. Install dependencies
```bash
cd whatsapp-bridge
npm install
```

### 2. Create .env
```bash
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...          # your existing Anthropic API key
OWNER_NUMBER=6512345678@c.us          # your personal number (no +, no spaces, add @c.us)
PROJECT_DIR=/Users/yourname/Documents/Claude Home
```

Your `OWNER_NUMBER` for `+65 8073 5469` → `6580735469@c.us`

### 3. First-time QR scan
```bash
node bot.js
```

A QR code appears in the terminal. Open WhatsApp on **Mochi's phone**, go to:
**Settings → Linked Devices → Link a Device** → scan the QR code.

Once authenticated you'll see `[auth] Session authenticated and saved`.
Press `Ctrl+C` — the session is saved and won't need re-scanning.

### 4. Start with pm2
```bash
pm2 start ecosystem.config.js
pm2 logs mochi          # watch logs
```

### 5. Survive reboots
```bash
pm2 startup             # prints a command — run it
pm2 save                # saves current process list
```

Mochi now starts automatically when your Mac boots.

---

## Usage

From your personal WhatsApp, message Mochi's number:

| You say | Mochi does |
|---|---|
| `"make a snake game"` | Generates a plan, asks to confirm |
| `"yes"` / `"ok"` / `"sure"` | Executes, commits, deploys |
| `"no"` / `"cancel"` | Cancels the plan |
| `"?"` or `"status"` | Reports current state |
| Any media/image | Asks you to describe it in text |

Plans expire after **10 minutes** if not confirmed.

---

## pm2 commands

```bash
pm2 status              # see if Mochi is running
pm2 logs mochi          # tail logs
pm2 restart mochi       # restart
pm2 stop mochi          # stop
pm2 delete mochi        # remove from pm2
```

---

## If Mochi needs re-scanning

If you see a `NEEDS_RESCAN` file in this directory, Mochi's WhatsApp session was invalidated (you unlinked the device from your phone). To re-scan:

```bash
pm2 stop mochi
rm -rf .wwebjs_auth NEEDS_RESCAN
node bot.js             # scan the new QR
pm2 restart mochi
```

---

## Known limitations

- **Offline auto-reply:** When your Mac is asleep, Mochi can't reply. He sends "Sorry, I was napping 😴" when he comes back online.
- **Session history resets** on pm2 restart — Claude starts a fresh context, but state (pending plans, etc.) is preserved.
- **whatsapp-web.js** is unofficial and may break after WhatsApp Web updates. Check for updates if Mochi stops connecting: `npm install whatsapp-web.js@latest`.
