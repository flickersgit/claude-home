'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'sessions.json');

// In-memory store: chatId → state object
const store = new Map();

// Load persisted state on startup — claudeSessionId IS restored (Phase 3)
function loadFromDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const [chatId, s] of Object.entries(raw)) {
      store.set(chatId, { ...defaultState(), ...s });
    }
    console.log(`[state] Loaded ${store.size} session(s) from disk`);
  } catch {
    // File doesn't exist yet — that's fine
  }
}

function saveToDisk() {
  const obj = {};
  for (const [chatId, s] of store) {
    obj[chatId] = s;
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2));
}

function defaultState() {
  return {
    status: 'idle',                  // 'idle' | 'awaiting_confirm' | 'awaiting_abandon_confirm' | 'executing' | 'awaiting_staging_confirm'
    pendingPlan: null,               // plan text waiting for confirmation
    pendingInstruction: null,        // original user instruction
    pendingNewInstruction: null,     // new instruction received while awaiting_confirm
    expiresAt: null,                 // Date.now() + 10 min — null when not awaiting
    claudeSessionId: null,           // SDK session ID — now persists across restarts
    lastGreetedDate: null,           // 'YYYY-MM-DD'
    interactionCount: 0,             // incremented on each generatePlan; triggers compaction at threshold
    stagingUrl: null,                // staging preview URL after execution, before prod deploy
  };
}

function getState(chatId) {
  if (!store.has(chatId)) {
    store.set(chatId, defaultState());
  }
  return store.get(chatId);
}

function setState(chatId, patch) {
  const current = getState(chatId);
  const next = { ...current, ...patch };
  store.set(chatId, next);
  saveToDisk();
  return next;
}

function clearPendingPlan(chatId) {
  return setState(chatId, {
    status: 'idle',
    pendingPlan: null,
    pendingInstruction: null,
    pendingNewInstruction: null,
    expiresAt: null,
    stagingUrl: null,
  });
}

function isPlanExpired(state) {
  return (
    state.status === 'awaiting_confirm' &&
    state.expiresAt !== null &&
    Date.now() > state.expiresAt
  );
}

function getAllChatIds() {
  return [...store.keys()];
}

loadFromDisk();

module.exports = { getState, setState, clearPendingPlan, isPlanExpired, getAllChatIds };
