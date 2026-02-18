'use strict';

require('dotenv').config();

const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const http = require('http');
const { exec } = require('child_process');

const { getState, setState, clearPendingPlan, isPlanExpired } = require('./state');
const mochi = require('./mochi');
const { generatePlan, executePlan } = require('./claude');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const OWNER_NUMBER = process.env.OWNER_NUMBER;
const PLAN_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

if (!OWNER_NUMBER) {
  console.error('[boot] OWNER_NUMBER is not set in .env — Mochi cannot start.');
  process.exit(1);
}

console.log(`[boot] Starting Mochi... Owner: ${OWNER_NUMBER}`);

// ---------------------------------------------------------------------------
// WhatsApp client
// ---------------------------------------------------------------------------
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'mochi',
    dataPath: './.wwebjs_auth',
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-dev-shm-usage',
    ],
  },
});

// ---------------------------------------------------------------------------
// Auth / lifecycle events
// ---------------------------------------------------------------------------
// Serve QR code in browser for easy scanning
let qrServer = null;
client.on('qr', async (qr) => {
  console.log('[auth] QR code ready — opening in browser...');
  const dataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 2 });
  const html = `<!DOCTYPE html><html><head><title>Mochi QR</title>
<style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#fff;font-family:sans-serif;}
img{border:12px solid #fff;border-radius:12px;}p{margin-top:20px;opacity:.6;font-size:14px;}</style></head>
<body><img src="${dataUrl}"><p>Scan with Mochi's WhatsApp → Settings → Linked Devices → Link a Device</p></body></html>`;

  if (!qrServer) {
    qrServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
    qrServer.listen(3131, () => {
      exec('open http://localhost:3131');
    });
  } else {
    // Update the served HTML for the new QR (refresh page to see it)
    qrServer.removeAllListeners('request');
    qrServer.on('request', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
  }
});

client.on('authenticated', () => {
  console.log('[auth] Session authenticated and saved');
  if (qrServer) { qrServer.close(); qrServer = null; }
});

client.on('auth_failure', (msg) => {
  console.error('[auth] Authentication failed:', msg);
});

client.on('ready', async () => {
  console.log('[wa]  Mochi is ready!');
  await handleReconnect();
});

let reconnectTimer = null;
client.on('disconnected', async (reason) => {
  console.warn('[wa]  Disconnected:', reason);

  if (reason === 'LOGOUT') {
    console.error('[wa]  Phone unlinked the device — manual QR re-scan required.');
    // Write sentinel file so pm2/operator knows
    require('fs').writeFileSync('./NEEDS_RESCAN', new Date().toISOString());
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    console.log('[wa]  Reconnecting...');
    try {
      await client.destroy();
    } catch {}
    client.initialize();
  }, 5_000);
});

// ---------------------------------------------------------------------------
// On ready: check for missed messages
// ---------------------------------------------------------------------------
async function handleReconnect() {
  try {
    const chat = await client.getChatById(OWNER_NUMBER);
    if (!chat) return;

    const unread = chat.unreadCount || 0;
    if (unread > 0) {
      console.log(`[reconnect] ${unread} unread message(s) from owner`);
      await client.sendMessage(OWNER_NUMBER, mochi.napComeBack());

      // Fetch recent messages and process the latest one
      const messages = await chat.fetchMessages({ limit: unread + 1 });
      const unreadMessages = messages.filter(m => !m.fromMe).slice(-unread);
      const latest = unreadMessages[unreadMessages.length - 1];

      if (latest) {
        await handleMessage(latest, true);
      }
    }
  } catch (err) {
    console.error('[reconnect] Could not check missed messages:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
client.on('message', async (msg) => {
  if (msg.fromMe) return;
  if (msg.from !== OWNER_NUMBER) return; // silently drop unknown senders

  await handleMessage(msg, false);
});

async function handleMessage(msg, fromReconnect) {
  const chatId = msg.from;
  const text = (msg.body || '').trim();

  // Non-text media
  if (msg.type !== 'chat') {
    await client.sendMessage(chatId, mochi.unsupportedMedia());
    return;
  }

  if (!text) return;

  const state = getState(chatId);

  // Status query
  if (mochi.isStatusQuery(text)) {
    await client.sendMessage(chatId, mochi.statusReport(state));
    return;
  }

  // Currently executing — can't interrupt
  if (state.status === 'executing') {
    await client.sendMessage(chatId, mochi.stillWorking());
    return;
  }

  // Awaiting "abandon old plan?" confirmation
  if (state.status === 'awaiting_abandon_confirm') {
    if (mochi.isConfirmation(text)) {
      // Abandon old, start new
      const newInstruction = state.pendingNewInstruction;
      clearPendingPlan(chatId);
      await processInstruction(chatId, newInstruction);
    } else if (mochi.isRejection(text)) {
      // Keep old plan
      setState(chatId, {
        status: 'awaiting_confirm',
        pendingNewInstruction: null,
      });
      await client.sendMessage(chatId, `OK, keeping the original plan! 👍\n\n${mochi.planMessage(state.pendingPlan)}`);
    } else {
      await client.sendMessage(chatId, `Please reply yes to abandon the old plan, or no to keep it.`);
    }
    return;
  }

  // Awaiting confirmation of a plan
  if (state.status === 'awaiting_confirm') {
    // Check expiry first
    if (isPlanExpired(state)) {
      clearPendingPlan(chatId);
      await client.sendMessage(chatId, mochi.planExpired());
      // Fall through to process as new instruction if text looks like one
      if (!mochi.isConfirmation(text) && !mochi.isRejection(text)) {
        await processInstruction(chatId, text);
      }
      return;
    }

    if (mochi.isConfirmation(text)) {
      await doExecute(chatId, state);
      return;
    }

    if (mochi.isRejection(text)) {
      clearPendingPlan(chatId);
      await client.sendMessage(chatId, mochi.cancelled());
      return;
    }

    // New instruction received while awaiting confirm
    setState(chatId, {
      status: 'awaiting_abandon_confirm',
      pendingNewInstruction: text,
    });
    await client.sendMessage(chatId, mochi.abandonPrompt(state.pendingInstruction, text));
    return;
  }

  // Idle — process as a new instruction
  await processInstruction(chatId, text);
}

// ---------------------------------------------------------------------------
// Process a new instruction: greet (if needed) → plan → send for confirmation
// ---------------------------------------------------------------------------
async function processInstruction(chatId, instruction) {
  const state = getState(chatId);

  // Daily greeting
  if (mochi.shouldGreet(state)) {
    await client.sendMessage(chatId, mochi.greeting());
    setState(chatId, { lastGreetedDate: mochi.todayString() });
  }

  // Acknowledge
  await client.sendMessage(chatId, mochi.thinking());

  // Generate plan (read-only)
  let plan, newSessionId;
  try {
    const result = await generatePlan(instruction, state.claudeSessionId);
    plan = result.plan;
    newSessionId = result.sessionId;
  } catch (err) {
    console.error('[claude] generatePlan error:', err);
    await client.sendMessage(chatId, mochi.errorReport(err.message));
    return;
  }

  // Store plan state
  setState(chatId, {
    status: 'awaiting_confirm',
    pendingPlan: plan,
    pendingInstruction: instruction,
    expiresAt: Date.now() + PLAN_EXPIRY_MS,
    claudeSessionId: newSessionId,
  });

  await client.sendMessage(chatId, mochi.planMessage(plan));
}

// ---------------------------------------------------------------------------
// Execute a confirmed plan
// ---------------------------------------------------------------------------
async function doExecute(chatId, state) {
  setState(chatId, { status: 'executing' });
  await client.sendMessage(chatId, mochi.confirmExecuting());

  let execResult;
  try {
    execResult = await executePlan(state.pendingInstruction, state.claudeSessionId);
  } catch (err) {
    console.error('[claude] executePlan error:', err);
    clearPendingPlan(chatId);
    await client.sendMessage(chatId, mochi.errorReport(err.message));
    return;
  }

  // Update session ID, clear pending plan
  setState(chatId, {
    status: 'idle',
    pendingPlan: null,
    pendingInstruction: null,
    expiresAt: null,
    claudeSessionId: execResult.sessionId,
  });

  // Build reply
  let reply;
  if (execResult.steps && execResult.steps.length > 0) {
    reply = mochi.partialReport({ steps: execResult.steps });
  } else if (execResult.success) {
    reply = mochi.successReport({
      filesChanged: execResult.filesChanged,
      commitHash: execResult.commitHash,
      commitMessage: execResult.commitMessage,
    });
  } else {
    reply = mochi.errorReport(execResult.raw || 'Unknown error during execution.');
  }

  await client.sendMessage(chatId, reply);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
client.initialize();
