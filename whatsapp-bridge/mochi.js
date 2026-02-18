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

const STATUS_WORDS = new Set([
  '?', 'status', 'state',
  'what are you doing', 'what are you working on',
  'busy', 'busy?', 'are you busy',
  'hello', 'hi', 'hey',
]);

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

function isStatusQuery(text) {
  const t = text.trim().toLowerCase();
  return STATUS_WORDS.has(t);
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

function greeting() {
  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  return `Good ${timeOfDay}! ☕ I'm Mochi — your game arcade assistant. What are we building today?`;
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

module.exports = {
  isConfirmation,
  isRejection,
  isStatusQuery,
  shouldGreet,
  todayString,
  greeting,
  thinking,
  planMessage,
  confirmExecuting,
  successReport,
  partialReport,
  cancelled,
  planExpired,
  stillWorking,
  unsupportedMedia,
  napComeBack,
  statusReport,
  abandonPrompt,
  errorReport,
};
