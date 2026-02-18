'use strict';

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const mochi = require('./mochi');

const HEARTBEAT_FILE = path.join(__dirname, 'HEARTBEAT.md');
const PROJECT_DIR = process.env.PROJECT_DIR || path.join(__dirname, '..');
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS ?? '1800000', 10); // 30 min
const DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

// Parse quiet hours from "HH:MM-HH:MM" format
const [quietStartStr = '22:00', quietEndStr = '08:00'] =
  (process.env.HEARTBEAT_QUIET_HOURS || '22:00-08:00').split('-');
const QUIET_START_H = parseInt(quietStartStr.split(':')[0], 10);
const QUIET_END_H = parseInt(quietEndStr.split(':')[0], 10);

// ---------------------------------------------------------------------------
// HEARTBEAT.md parser
// ---------------------------------------------------------------------------
function parseHeartbeat() {
  let raw;
  try {
    raw = fs.readFileSync(HEARTBEAT_FILE, 'utf8');
  } catch {
    return []; // file missing — heartbeat disabled
  }

  const checks = [];
  // Split on "## " section headers
  const sections = raw.split(/^## /m).slice(1);

  for (const section of sections) {
    const lines = section.split('\n');
    const name = lines[0].trim();
    const check = { name };

    for (const line of lines.slice(1)) {
      const match = line.match(/^([\w_]+):\s*(.*)/);
      if (!match) continue;
      const [, key, value] = match;
      // Strip surrounding quotes if present
      check[key] = value.replace(/^["']|["']$/g, '').trim();
    }

    if (check.command) checks.push(check);
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Run a single check → { alert: bool, name, message }
// ---------------------------------------------------------------------------
function runCheck(check) {
  return new Promise((resolve) => {
    const cmd = check.command.replace(/\$PROJECT_DIR/g, PROJECT_DIR);

    exec(cmd, { shell: '/bin/sh' }, (err, stdout) => {
      const output = (stdout || '').trim();

      if (check.alert_if_output !== undefined) {
        // Alert if command produces any output
        if (output) {
          const template = check.alert_if_output.replace(/\\n/g, '\n');
          resolve({
            alert: true,
            name: check.name,
            message: template.replace('{output}', output),
          });
        } else {
          resolve({ alert: false });
        }

      } else if (check.alert_if_gt !== undefined) {
        // Alert if numeric output exceeds threshold
        const val = parseFloat(output);
        const threshold = parseFloat(check.alert_if_gt);
        if (!isNaN(val) && val > threshold) {
          const template = (check.alert || '⚠️ Value is {value}').replace(/\\n/g, '\n');
          resolve({
            alert: true,
            name: check.name,
            message: template.replace('{value}', String(val)),
          });
        } else {
          resolve({ alert: false });
        }

      } else {
        // Default: alert if command exits non-zero
        if (err) {
          const message = (check.alert || `⚠️ ${check.name} check failed`).replace(/\\n/g, '\n');
          resolve({ alert: true, name: check.name, message });
        } else {
          resolve({ alert: false });
        }
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------
function isQuietHours() {
  const h = new Date().getHours();
  if (QUIET_START_H > QUIET_END_H) {
    // Overnight range: e.g. 22:00–08:00
    return h >= QUIET_START_H || h < QUIET_END_H;
  }
  return h >= QUIET_START_H && h < QUIET_END_H;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const lastAlerted = new Map(); // checkName → timestamp of last alert/queue
const alertQueue = [];

// ---------------------------------------------------------------------------
// Run all checks, send or queue alerts
// ---------------------------------------------------------------------------
async function runChecks(client, ownerNumber, getState) {
  const checks = parseHeartbeat();
  if (!checks.length) return;

  const results = await Promise.all(checks.map(runCheck));

  for (const result of results) {
    if (!result.alert) continue;

    // Deduplication: skip if alerted/queued within 2 hours
    const lastTime = lastAlerted.get(result.name) || 0;
    if (Date.now() - lastTime < DEDUP_WINDOW_MS) continue;

    // Quiet hours: skip sending
    if (isQuietHours()) continue;

    // Mark as alerted now (prevents duplicate queueing during long executions)
    lastAlerted.set(result.name, Date.now());

    const message = mochi.heartbeatAlert(result.name, result.message);
    const state = getState(ownerNumber);

    if (state.status === 'executing') {
      alertQueue.push(message);
      console.log(`[heartbeat] queued alert: ${result.name}`);
    } else {
      try {
        await client.sendMessage(ownerNumber, message);
        console.log(`[heartbeat] sent alert: ${result.name}`);
      } catch (err) {
        console.error('[heartbeat] send error:', err.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
function start(client, ownerNumber, getState) {
  if (HEARTBEAT_INTERVAL_MS === 0) {
    console.log('[heartbeat] disabled (HEARTBEAT_INTERVAL_MS=0)');
    return;
  }

  const mins = HEARTBEAT_INTERVAL_MS / 60_000;
  console.log(`[heartbeat] starting — interval ${mins}min, quiet ${QUIET_START_H}:00–${QUIET_END_H}:00`);

  setInterval(() => {
    runChecks(client, ownerNumber, getState).catch((err) => {
      console.error('[heartbeat] runChecks error:', err.message);
    });
  }, HEARTBEAT_INTERVAL_MS);
}

async function flushQueue(client, ownerNumber) {
  if (!alertQueue.length) return;
  const batch = alertQueue.splice(0);
  for (const msg of batch) {
    try {
      await client.sendMessage(ownerNumber, msg);
    } catch (err) {
      console.error('[heartbeat] flushQueue error:', err.message);
    }
  }
  console.log(`[heartbeat] flushed ${batch.length} queued alert(s)`);
}

module.exports = { start, flushQueue };
