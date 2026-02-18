'use strict';

require('dotenv').config();

const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const http = require('http');
const { exec } = require('child_process');
const path = require('path');

const { getState, setState, clearPendingPlan, isPlanExpired } = require('./state');
const mochi = require('./mochi');
const { generatePlan, executePlan, compactSession, COMPACTION_THRESHOLD } = require('./claude');
const heartbeat = require('./heartbeat');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const OWNER_NUMBER = process.env.OWNER_NUMBER;
const PLAN_EXPIRY_MS = 10 * 60 * 1000;   // 10 minutes
const EXECUTION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const MEMORY_FILE = path.join(__dirname, 'MEMORY.md');

if (!OWNER_NUMBER) {
  console.error('[boot] OWNER_NUMBER is not set in .env — Mochi cannot start.');
  process.exit(1);
}

// Allow list — OWNER_NUMBER is always included; add more via ALLOWED_NUMBERS="num1,num2"
const ALLOWED_NUMBERS = new Set([
  OWNER_NUMBER,
  ...((process.env.ALLOWED_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean)),
]);

console.log(`[boot] Starting Mochi... Owner: ${OWNER_NUMBER}, allowed: ${ALLOWED_NUMBERS.size} number(s)`);

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
  heartbeat.start(client, OWNER_NUMBER, getState);
});

let reconnectTimer = null;
client.on('disconnected', async (reason) => {
  console.warn('[wa]  Disconnected:', reason);

  if (reason === 'LOGOUT') {
    console.error('[wa]  Phone unlinked the device — manual QR re-scan required.');
    fs.writeFileSync('./NEEDS_RESCAN', new Date().toISOString());
    return;
  }

  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    console.log('[wa]  Reconnecting...');
    try { await client.destroy(); } catch {}
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
  console.log(`[msg] from=${msg.from} fromMe=${msg.fromMe} type=${msg.type} body=${(msg.body||'').slice(0,50)}`);
  if (msg.fromMe) return;
  if (!ALLOWED_NUMBERS.has(msg.from)) {
    console.log(`[msg] dropped — ${msg.from} not in allow list`);
    return;
  }

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

  // Memory queries — handle before everything else
  if (mochi.isMemoryQuery(text)) {
    try {
      const contents = fs.readFileSync(MEMORY_FILE, 'utf8');
      await client.sendMessage(chatId, mochi.memoryReport(contents));
    } catch {
      await client.sendMessage(chatId, mochi.memoryReport(''));
    }
    return;
  }

  // Forget query — ask for confirmation first
  if (mochi.isForgetQuery(text)) {
    if (state.status === 'awaiting_forget_confirm') {
      // They already got the prompt and are confirming
      if (mochi.isConfirmation(text)) {
        try {
          fs.writeFileSync(MEMORY_FILE, '# Mochi Memory\n');
        } catch (err) {
          console.error('[memory] Failed to clear MEMORY.md:', err.message);
        }
        setState(chatId, { status: 'idle' });
        await client.sendMessage(chatId, mochi.memoryCleared());
      } else {
        setState(chatId, { status: 'idle' });
        await client.sendMessage(chatId, 'OK, keeping the memory! 👍');
      }
    } else {
      setState(chatId, { status: 'awaiting_forget_confirm' });
      await client.sendMessage(chatId, '🗑️ Clear all my memory? This cannot be undone. (yes / no)');
    }
    return;
  }

  // Handle forget confirmation replies
  if (state.status === 'awaiting_forget_confirm') {
    if (mochi.isConfirmation(text)) {
      try {
        fs.writeFileSync(MEMORY_FILE, '# Mochi Memory\n');
      } catch (err) {
        console.error('[memory] Failed to clear MEMORY.md:', err.message);
      }
      setState(chatId, { status: 'idle' });
      await client.sendMessage(chatId, mochi.memoryCleared());
    } else {
      setState(chatId, { status: 'idle' });
      await client.sendMessage(chatId, 'OK, keeping the memory! 👍');
    }
    return;
  }

  // Casual greeting — respond with a fun reply, no planning
  if (mochi.isGreeting(text)) {
    await client.sendMessage(chatId, mochi.casualGreeting());
    return;
  }

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

  // Awaiting staging sign-off before production deploy
  if (state.status === 'awaiting_staging_confirm') {
    if (mochi.isConfirmation(text)) {
      await doDeployToProd(chatId);
    } else if (mochi.isRevertCommand(text)) {
      await doRevertStaging(chatId);
    } else if (mochi.isRejection(text)) {
      // Cancel prod deploy but keep staged — back to idle
      setState(chatId, { status: 'idle', stagingUrl: null });
      await client.sendMessage(chatId, 'OK, not deploying to production. Changes are staged and committed. 👍');
    } else {
      await client.sendMessage(chatId, `🧪 Still waiting on staging sign-off.\n\nTest it: ${state.stagingUrl || '(staging URL unavailable)'}\n\nReply yes to ship to prod, no to skip, or revert to undo.`);
    }
    return;
  }

  // Awaiting "abandon old plan?" confirmation
  if (state.status === 'awaiting_abandon_confirm') {
    if (mochi.isConfirmation(text)) {
      const newInstruction = state.pendingNewInstruction;
      clearPendingPlan(chatId);
      await processInstruction(chatId, newInstruction);
    } else if (mochi.isRejection(text)) {
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
    if (isPlanExpired(state)) {
      clearPendingPlan(chatId);
      await client.sendMessage(chatId, mochi.planExpired());
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
// Process a new instruction: greet (if needed) → compact (if needed) → plan
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

  // Compaction check — run before generating a new plan
  const currentCount = state.interactionCount || 0;
  if (currentCount > 0 && currentCount % COMPACTION_THRESHOLD === 0 && state.claudeSessionId) {
    await client.sendMessage(chatId, mochi.compacting());
    await compactSession(state.claudeSessionId);
    setState(chatId, { claudeSessionId: null }); // fresh session after compaction
  }

  // Increment interaction count
  const newCount = currentCount + 1;
  setState(chatId, { interactionCount: newCount });

  // Classify intent and generate plan/reply
  let result;
  try {
    const freshState = getState(chatId);
    result = await generatePlan(instruction, freshState.claudeSessionId);
  } catch (err) {
    console.error('[claude] generatePlan error:', err);
    await client.sendMessage(chatId, mochi.errorReport(err.message));
    return;
  }

  // Conversational reply — no plan confirmation needed
  if (result.type === 'chat') {
    setState(chatId, { claudeSessionId: result.sessionId });
    await client.sendMessage(chatId, result.reply);
    return;
  }

  // Task — store plan and await confirmation
  setState(chatId, {
    status: 'awaiting_confirm',
    pendingPlan: result.plan,
    pendingInstruction: instruction,
    expiresAt: Date.now() + PLAN_EXPIRY_MS,
    claudeSessionId: result.sessionId,
  });

  await client.sendMessage(chatId, mochi.planMessage(result.plan));
}

// ---------------------------------------------------------------------------
// Execute a confirmed plan — with 15-minute timeout
// ---------------------------------------------------------------------------
async function doExecute(chatId, state) {
  setState(chatId, { status: 'executing' });
  await client.sendMessage(chatId, mochi.confirmExecuting());

  let execResult;
  let timedOut = false;

  const timeoutHandle = setTimeout(async () => {
    timedOut = true;
    clearPendingPlan(chatId);
    console.error('[claude] executePlan timed out after 15 minutes');
    try {
      await client.sendMessage(chatId, mochi.executionTimeout());
    } catch {}
  }, EXECUTION_TIMEOUT_MS);

  try {
    execResult = await executePlan(state.pendingInstruction, state.claudeSessionId);
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (timedOut) return;
    console.error('[claude] executePlan error:', err);
    clearPendingPlan(chatId);
    await client.sendMessage(chatId, mochi.errorReport(err.message));
    return;
  }

  clearTimeout(timeoutHandle);
  if (timedOut) return;

  // If execution had step failures, report and go idle
  if (execResult.steps && execResult.steps.length > 0) {
    setState(chatId, {
      status: 'idle',
      pendingPlan: null,
      pendingInstruction: null,
      expiresAt: null,
      claudeSessionId: execResult.sessionId,
      stagingUrl: null,
    });
    await client.sendMessage(chatId, mochi.partialReport({ steps: execResult.steps }));
    heartbeat.flushQueue(client, OWNER_NUMBER);
    return;
  }

  // Staged successfully — wait for prod sign-off
  if (execResult.success && execResult.stagingUrl) {
    setState(chatId, {
      status: 'awaiting_staging_confirm',
      pendingPlan: null,
      pendingInstruction: null,
      expiresAt: null,
      claudeSessionId: execResult.sessionId,
      stagingUrl: execResult.stagingUrl,
    });
    await client.sendMessage(chatId, mochi.stagingReady(execResult.stagingUrl));
    heartbeat.flushQueue(client, OWNER_NUMBER);
    return;
  }

  // No staging URL captured — fall back to direct success/error report
  setState(chatId, {
    status: 'idle',
    pendingPlan: null,
    pendingInstruction: null,
    expiresAt: null,
    claudeSessionId: execResult.sessionId,
    stagingUrl: null,
  });

  const reply = execResult.success
    ? mochi.successReport({
        filesChanged: execResult.filesChanged,
        commitHash: execResult.commitHash,
        commitMessage: execResult.commitMessage,
      })
    : mochi.errorReport(execResult.raw || 'Unknown error during execution.');

  await client.sendMessage(chatId, reply);

  // Deliver any queued heartbeat alerts after execution completes
  heartbeat.flushQueue(client, OWNER_NUMBER);
}

// ---------------------------------------------------------------------------
// Deploy staged build to production
// ---------------------------------------------------------------------------
async function doDeployToProd(chatId) {
  setState(chatId, { status: 'executing' });
  await client.sendMessage(chatId, mochi.shippingToProd());

  try {
    await new Promise((resolve, reject) => {
      exec(
        'wrangler pages deploy . --project-name game-arcade',
        { cwd: process.env.PROJECT_DIR || path.join(__dirname, '..'), env: process.env },
        (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout),
      );
    });
    setState(chatId, { status: 'idle', stagingUrl: null });
    await client.sendMessage(chatId, mochi.prodDeployed());
  } catch (err) {
    console.error('[deploy] production deploy failed:', err.message);
    setState(chatId, { status: 'idle', stagingUrl: null });
    await client.sendMessage(chatId, mochi.errorReport(`Production deploy failed: ${err.message}`));
  }

  heartbeat.flushQueue(client, OWNER_NUMBER);
}

// ---------------------------------------------------------------------------
// Revert the last commit and push
// ---------------------------------------------------------------------------
async function doRevertStaging(chatId) {
  setState(chatId, { status: 'executing' });
  await client.sendMessage(chatId, mochi.revertingChanges());

  const projectDir = process.env.PROJECT_DIR || path.join(__dirname, '..');

  try {
    await new Promise((resolve, reject) => {
      exec(
        'git revert HEAD --no-edit && git push',
        { cwd: projectDir, env: process.env },
        (err, stdout, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(stdout),
      );
    });
    setState(chatId, { status: 'idle', stagingUrl: null });
    await client.sendMessage(chatId, mochi.reverted());
  } catch (err) {
    console.error('[revert] git revert failed:', err.message);
    setState(chatId, { status: 'idle', stagingUrl: null });
    await client.sendMessage(chatId, mochi.errorReport(`Revert failed: ${err.message}`));
  }

  heartbeat.flushQueue(client, OWNER_NUMBER);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
client.initialize();
