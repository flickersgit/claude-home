'use strict';

// ---------------------------------------------------------------------------
// Mochi — personality, message templates, and text matchers
// ---------------------------------------------------------------------------

const CONFIRM_WORDS = new Set([
  'yes', 'yeah', 'yep', 'yup', 'y',
  'ok', 'okay', 'k',
  'sure', 'certainly', 'absolutely',
  'do it', 'go ahead', 'go', 'proceed', 'let\'s go', 'lets go',
  '✅', 'confirmed', 'confirm', 'approve', 'approved',
]);

const REJECT_WORDS = new Set([
  'no', 'nope', 'n', 'nah',
  'cancel', 'cancelled', 'stop',
  'abort', 'abort!',
  'never mind', 'nevermind', 'nvm',
  'don\'t', 'dont',
  '❌', 'reject', 'rejected',
]);

const REVERT_WORDS = new Set([
  'revert', 'rollback', 'roll back', 'undo', 'undo it',
  'revert it', 'roll it back',
]);

const STATUS_WORDS = new Set([
  '?', 'status', 'state',
  'what are you doing', 'what are you working on',
  'busy', 'busy?', 'are you busy',
]);

const GREETING_WORDS = new Set([
  'hello', 'hi', 'hey', 'hiya',
  'yo', 'sup', 'wassup', 'what\'s up', 'whats up',
  'howdy', 'heya', 'morning', 'afternoon', 'evening',
  'yo!', 'hey!', 'hi!', 'hello!',
]);

const MEMORY_QUERY_PHRASES = [
  'what do you remember', 'show your memory', 'show memory',
  'what do you know', 'your memory', 'memory',
];

const FORGET_PHRASES = [
  'forget everything', 'clear memory', 'clear your memory',
  'wipe memory', 'reset memory',
];

function isConfirmation(text) {
  const t = text.trim().toLowerCase();
  if (CONFIRM_WORDS.has(t)) return true;
  // Also match phrases containing confirmation words
  return ['yes', 'yeah', 'ok', 'sure', 'go ahead', 'do it', 'proceed'].some(w => t.startsWith(w));
}

function isRejection(text) {
  const t = text.trim().toLowerCase();
  if (REJECT_WORDS.has(t)) return true;
  return ['no', 'nope', 'cancel', 'stop', 'abort', 'never mind', 'nevermind'].some(w => t.startsWith(w));
}

function isRevertCommand(text) {
  const t = text.trim().toLowerCase();
  return REVERT_WORDS.has(t) || t.startsWith('revert') || t.startsWith('rollback') || t.startsWith('undo');
}

function isStatusQuery(text) {
  const t = text.trim().toLowerCase();
  return STATUS_WORDS.has(t);
}

function isGreeting(text) {
  const t = text.trim().toLowerCase();
  return GREETING_WORDS.has(t);
}

function isMemoryQuery(text) {
  const t = text.trim().toLowerCase();
  return MEMORY_QUERY_PHRASES.some(p => t === p || t.startsWith(p));
}

function isForgetQuery(text) {
  const t = text.trim().toLowerCase();
  return FORGET_PHRASES.some(p => t === p || t.startsWith(p));
}

// Returns today's date as YYYY-MM-DD in the local timezone
function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function shouldGreet(state) {
  return state.lastGreetedDate !== todayString();
}

// ---------------------------------------------------------------------------
// Message templates
// ---------------------------------------------------------------------------

function greeting(name) {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const hi = name ? `Good ${timeOfDay}, ${name}!` : `Good ${timeOfDay}!`;
  return `${hi} ☕ I'm Mochi — your game arcade assistant. What are we building today?`;
}

const CASUAL_GREETINGS = [
  "Hey hey! 👋 Ready to build something fun?",
  "Yo! 🎮 What are we making today?",
  "Heyyy! Mochi's here and caffeinated ☕ What's the mission?",
  "Oh hi! 👾 Got a game idea brewing?",
  "Sup! 🕹️ Tell me what to build!",
  "Hiya! Ready when you are — what's on the agenda?",
];

const CASUAL_GREETINGS_NAMED = [
  (n) => `Hey ${n}! 👋 Ready to build something fun?`,
  (n) => `Yo ${n}! 🎮 What are we making today?`,
  (n) => `${n}! Mochi's here and caffeinated ☕ What's the mission?`,
  (n) => `Oh hi ${n}! 👾 Got a game idea brewing?`,
  (n) => `Sup ${n}! 🕹️ Tell me what to build!`,
  (n) => `Hey ${n}! Ready when you are — what's on the agenda?`,
];

function casualGreeting(name) {
  const idx = Math.floor(Math.random() * CASUAL_GREETINGS.length);
  return name ? CASUAL_GREETINGS_NAMED[idx](name) : CASUAL_GREETINGS[idx];
}

function thinking() {
  return '🧠 On it, give me a moment...';
}

function planMessage(plan) {
  return `${plan}\n\nConfirm? (yes / no)`;
}

function confirmExecuting() {
  return '🔨 Got it! Building now...';
}

function successReport({ filesChanged, commitHash, commitMessage }) {
  const fileList = filesChanged && filesChanged.length
    ? filesChanged.slice(0, 5).join(', ') + (filesChanged.length > 5 ? ` (+${filesChanged.length - 5} more)` : '')
    : 'files updated';
  const commitLine = commitHash ? `\nCommit: ${commitHash.slice(0, 7)} — ${commitMessage || 'changes applied'}` : '';
  return `✅ Done!\nFiles: ${fileList}${commitLine}\nLive at: game-arcade.graciebelle.cc`;
}

function stagingReady({ stagingUrl, filesChanged, commitHash, commitMessage } = {}) {
  const fileList = filesChanged && filesChanged.length
    ? filesChanged.slice(0, 5).join(', ') + (filesChanged.length > 5 ? ` (+${filesChanged.length - 5} more)` : '')
    : null;
  const commitLine = commitHash ? `Commit: ${commitHash.slice(0, 7)} — ${commitMessage || 'changes applied'}` : null;
  const urlLine = stagingUrl ? `Test it here:\n${stagingUrl}` : null;

  const details = [fileList && `Files: ${fileList}`, commitLine, urlLine].filter(Boolean).join('\n');
  return `🧪 Done! Changes staged and committed.\n${details}\n\nLooks good?\n• yes — ship to production\n• no — leave it staged for now\n• revert — undo the changes`;
}

function shippingToProd() {
  return '🚀 Shipping to production...';
}

function prodDeployed() {
  return '✅ Live at: game-arcade.graciebelle.cc';
}

function revertingChanges() {
  return '↩️ Reverting changes...';
}

function reverted() {
  return '↩️ Changes reverted. Back to the previous version.';
}

function partialReport({ steps }) {
  const lines = steps.map(s => `${s.ok ? '✅' : '❌'} ${s.label}${s.error ? ': ' + s.error : ''}`);
  return `⚠️ Partially done:\n${lines.join('\n')}`;
}

function cancelled() {
  return 'Got it, plan cancelled! 🙌 What else can I help with?';
}

function planExpired() {
  return '⏰ That plan expired after 10 minutes. What would you like to do?';
}

function stillWorking() {
  return "Still working on it, hold tight! ⏳ I'll let you know when I'm done.";
}

function unsupportedMedia() {
  return "I can only read text for now! 🙈 Send me a description of what you'd like to build.";
}

function napComeBack() {
  return "Hey! Sorry, I was napping 😴 I'm back now!";
}

function statusReport(state) {
  switch (state.status) {
    case 'idle':
      return '😎 All good here — what would you like to build?';
    case 'awaiting_confirm': {
      const mins = state.expiresAt ? Math.max(0, Math.round((state.expiresAt - Date.now()) / 60000)) : '?';
      return `⏳ Waiting on your confirmation for:\n"${state.pendingInstruction}"\n\nExpires in ~${mins} min. (yes / no)`;
    }
    case 'awaiting_abandon_confirm':
      return `🤔 I have a pending plan for:\n"${state.pendingInstruction}"\n\nAnd you sent a new instruction. Abandon the old plan? (yes / no)`;
    case 'executing':
      return '🔨 Currently executing a plan. Almost done!';
    case 'awaiting_staging_confirm':
      return `🧪 Waiting for staging sign-off:\n${state.stagingUrl || '(url not available)'}\n\nReply yes to ship to production, no to leave staged, or revert to undo.`;
    default:
      return '🤷 Not sure what I\'m doing tbh. Try sending a new instruction!';
  }
}

function abandonPrompt(oldInstruction, newInstruction) {
  const oldSummary = oldInstruction.length > 60 ? oldInstruction.slice(0, 60) + '…' : oldInstruction;
  const newSummary = newInstruction.length > 60 ? newInstruction.slice(0, 60) + '…' : newInstruction;
  return `Hold on — I still have a pending plan for:\n"${oldSummary}"\n\nAbandon it and work on:\n"${newSummary}"\n\ninstead? (yes / no)`;
}

function errorReport(error) {
  return `❌ Something went wrong:\n${error}`;
}

function memoryReport(contents) {
  if (!contents || !contents.trim()) return "🧠 My memory is empty — I haven't stored anything yet.";
  return `🧠 Here's what I remember:\n\n${contents.trim()}`;
}

function memoryCleared() {
  return '🗑️ Memory cleared! Starting fresh.';
}

function sessionReset() {
  return '🔄 Lost conversation context after restart — starting a fresh session.';
}

function compacting() {
  return '📝 Archiving context before we continue...';
}

function heartbeatAlert(checkName, message) {
  return `⚠️ Heartbeat: ${checkName}\n${message}\n\nTo investigate, just tell me what to check.`;
}

function executionTimeout() {
  return '⏱️ Execution timed out after 15 minutes. The task may have partially completed — check the project directory.';
}

module.exports = {
  isConfirmation,
  isRejection,
  isRevertCommand,
  isStatusQuery,
  isGreeting,
  isMemoryQuery,
  isForgetQuery,
  casualGreeting,
  shouldGreet,
  todayString,
  greeting,
  thinking,
  planMessage,
  confirmExecuting,
  successReport,
  stagingReady,
  shippingToProd,
  prodDeployed,
  revertingChanges,
  reverted,
  partialReport,
  cancelled,
  planExpired,
  stillWorking,
  unsupportedMedia,
  napComeBack,
  statusReport,
  abandonPrompt,
  errorReport,
  memoryReport,
  memoryCleared,
  sessionReset,
  compacting,
  heartbeatAlert,
  executionTimeout,
};
