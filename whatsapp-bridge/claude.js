'use strict';

// ---------------------------------------------------------------------------
// Claude integration — two-phase plan / execute using Claude Code SDK
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const PROJECT_DIR = process.env.PROJECT_DIR || path.join(__dirname, '..');
const CLAUDE_PATH = process.env.CLAUDE_PATH || '/Users/statpods/.local/bin/claude';

// Remove CLAUDECODE so the SDK can spawn a subprocess without the nested-session error
delete process.env.CLAUDECODE;

// ---------------------------------------------------------------------------
// Model routing — Haiku → Sonnet → Opus cascade
// ---------------------------------------------------------------------------
const PLAN_MODELS = [
  'claude-haiku-4-5-20251001', // fast + cheap: try first
  'claude-sonnet-4-6',          // escalate on failure
  'claude-opus-4-6',            // last resort: deep thinking
];
const EXEC_MODELS = [
  'claude-sonnet-4-6',  // execution needs real capability; skip Haiku
  'claude-opus-4-6',
];

// ---------------------------------------------------------------------------
// Compaction threshold
// ---------------------------------------------------------------------------
const COMPACTION_THRESHOLD = 20; // interactions before compacting session

const COMPACTION_PROMPT = `You have had a long conversation about the game-arcade project. Before we start fresh:
1. Review what was accomplished and learned.
2. Append any important facts or decisions to whatsapp-bridge/MEMORY.md (one line per fact, format: "- YYYY-MM-DD: <fact>").
3. Reply with only the word: COMPACTED

Do not make any other file changes.`;

// ---------------------------------------------------------------------------
// Hardcoded fallback if SOUL.md is missing
// ---------------------------------------------------------------------------
const FALLBACK_SOUL = `
You are Mochi, a playful and warm AI assistant for the game-arcade project.
Project directory: ${PROJECT_DIR}
Deploy command: wrangler pages deploy . --project-name game-arcade
After editing files: git add <changed files>, git commit -m "<message>", git push, then deploy.
Keep replies concise and plain text only — this is a WhatsApp chat, no markdown formatting.
When reporting what you did, use this exact format on success:
FILES: file1.html, file2.html
COMMIT: <7-char hash> — <commit message>
On partial failure use:
STEP_OK: <step name>
STEP_FAIL: <step name> | <error>
`.trim();

// ---------------------------------------------------------------------------
// File loaders
// ---------------------------------------------------------------------------
function loadSoul() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'SOUL.md'), 'utf8');
    if (raw.length > 3000) {
      console.warn('[claude] SOUL.md exceeds 3000 chars — truncating');
      return raw.slice(0, 3000);
    }
    return raw;
  } catch {
    console.warn('[claude] SOUL.md not found — using fallback system prompt');
    return FALLBACK_SOUL;
  }
}

function loadMemory() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'MEMORY.md'), 'utf8');
    if (raw.length > 4000) {
      // Trim oldest lines: keep the header line + most recent entries
      const lines = raw.split('\n');
      const header = lines[0]; // "# Mochi Memory"
      const entries = lines.slice(1).filter(l => l.trim());
      // Keep as many entries as fit in 3900 chars (leaving room for header)
      let kept = [];
      let size = header.length + 1;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (size + entries[i].length + 1 > 3900) break;
        kept.unshift(entries[i]);
        size += entries[i].length + 1;
      }
      console.warn(`[claude] MEMORY.md trimmed to ${kept.length} entries`);
      return `${header}\n${kept.join('\n')}`;
    }
    return raw;
  } catch {
    return ''; // No memory yet is fine
  }
}

function buildSystemPrompt() {
  const soul = loadSoul();
  const memory = loadMemory();
  if (!memory) return soul;
  return `${soul}\n\n## What I remember:\n${memory}`;
}

// ---------------------------------------------------------------------------
// SDK lazy-loader
// ---------------------------------------------------------------------------
let sdk = null;
function getSdk() {
  if (!sdk) {
    try {
      sdk = require('@anthropic-ai/claude-code');
    } catch (e) {
      throw new Error('Claude Code SDK not installed. Run: npm install @anthropic-ai/claude-code');
    }
  }
  return sdk;
}

// ---------------------------------------------------------------------------
// Sanitize text before sending to WhatsApp
// ---------------------------------------------------------------------------
function sanitize(text) {
  if (!text) return text;
  let s = text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[API_KEY]')
    .replace(new RegExp(PROJECT_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~')
    .replace(/\/Users\/[^/\s]+/g, '~');
  if (s.length > 1500) s = s.slice(0, 1497) + '…';
  return s;
}

// ---------------------------------------------------------------------------
// Parse Claude's structured output
// ---------------------------------------------------------------------------
function parseResult(text) {
  const lines = text.split('\n');
  const result = {
    success: true,
    filesChanged: [],
    commitHash: null,
    commitMessage: null,
    steps: [],
    raw: text,
  };

  for (const line of lines) {
    if (line.startsWith('FILES:')) {
      result.filesChanged = line.replace('FILES:', '').trim().split(',').map(f => f.trim()).filter(Boolean);
    } else if (line.startsWith('COMMIT:')) {
      const commitPart = line.replace('COMMIT:', '').trim();
      const match = commitPart.match(/^([a-f0-9]{7,40})\s*(?:—|--)?\s*(.*)$/);
      if (match) {
        result.commitHash = match[1];
        result.commitMessage = match[2].trim();
      }
    } else if (line.startsWith('STEP_OK:')) {
      result.steps.push({ ok: true, label: line.replace('STEP_OK:', '').trim() });
    } else if (line.startsWith('STEP_FAIL:')) {
      result.success = false;
      const parts = line.replace('STEP_FAIL:', '').split('|');
      result.steps.push({ ok: false, label: parts[0].trim(), error: sanitize((parts[1] || '').trim()) });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Core query runner
// ---------------------------------------------------------------------------
async function runQuery(prompt, options) {
  const { query } = getSdk();
  let text = '';
  let newSessionId = options.resume || null;

  for await (const msg of query({ prompt, options })) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      newSessionId = msg.session_id;
    }
    if (msg.type === 'result' && msg.subtype === 'success') {
      text = msg.result || '';
    }
    if (msg.type === 'result' && msg.subtype === 'error_max_turns') {
      text = msg.result || '';
    }
  }

  return { text, sessionId: newSessionId };
}

// ---------------------------------------------------------------------------
// Phase 1: generate a plan (read-only tools) — Haiku → Sonnet → Opus
// ---------------------------------------------------------------------------
async function generatePlan(instruction, sessionId) {
  const baseOpts = {
    cwd: PROJECT_DIR,
    allowedTools: ['Read', 'Glob', 'Grep'],
    permissionMode: 'default',
    maxTurns: 12,
    systemPrompt: buildSystemPrompt(),
    pathToClaudeCodeExecutable: CLAUDE_PATH,
  };

  const prompt = sessionId
    ? `New instruction: ${instruction}\n\nDescribe what you would do to fulfill this request. List the files you'd create or modify, and what changes you'd make. Be concise — this is for a WhatsApp confirmation message.`
    : `You are working on the game-arcade project. The user wants you to: ${instruction}\n\nDescribe what you would do to fulfill this request. List the files you'd create or modify, and what changes you'd make. Be concise — this is for a WhatsApp confirmation message.`;

  let currentSessionId = sessionId;
  let lastErr;

  for (const model of PLAN_MODELS) {
    try {
      const opts = { ...baseOpts, model };
      if (currentSessionId) opts.resume = currentSessionId;

      const { text, sessionId: sid } = await runQuery(prompt, opts);

      if (text && text.length >= 30) {
        console.log(`[claude] plan: ✓ ${model}`);
        return { plan: sanitize(text), sessionId: sid };
      }

      console.log(`[claude] plan: ${model} returned empty — escalating`);
    } catch (err) {
      lastErr = err;
      console.log(`[claude] plan: ${model} failed (${err.message}) — escalating`);
    }

    currentSessionId = null; // start fresh session on escalation
  }

  throw lastErr || new Error('All models failed to generate a plan');
}

// ---------------------------------------------------------------------------
// Context compaction — summarise and write to MEMORY.md, then reset session
// ---------------------------------------------------------------------------
async function compactSession(sessionId) {
  const opts = {
    cwd: PROJECT_DIR,
    allowedTools: ['Write', 'Read'],
    permissionMode: 'bypassPermissions',
    allowedDangerouslySkipPermissions: true,
    maxTurns: 3,
    systemPrompt: loadSoul(),
    pathToClaudeCodeExecutable: CLAUDE_PATH,
    model: 'claude-sonnet-4-6',
  };
  if (sessionId) opts.resume = sessionId;

  try {
    await runQuery(COMPACTION_PROMPT, opts);
    console.log('[claude] compaction complete');
  } catch (err) {
    console.error('[claude] compaction failed (continuing anyway):', err.message);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: execute the plan (full tools) — Sonnet → Opus
// ---------------------------------------------------------------------------
async function executePlan(instruction, sessionId) {
  const baseOpts = {
    cwd: PROJECT_DIR,
    allowedTools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Bash', 'Glob', 'Grep'],
    permissionMode: 'bypassPermissions',
    allowedDangerouslySkipPermissions: true,
    maxTurns: 30,
    systemPrompt: buildSystemPrompt(),
    pathToClaudeCodeExecutable: CLAUDE_PATH,
  };

  const prompt = `The user confirmed the plan. Now execute it.

Original instruction: ${instruction}

After making all file changes:
1. Run: git add <all changed files — list them explicitly, do NOT use git add . or git add -A>
2. Run: git commit -m "feat: <brief description>"
3. Run: git push
4. Run: wrangler pages deploy . --project-name game-arcade

Do NOT add or commit: whatsapp-bridge/MEMORY.md, whatsapp-bridge/SOUL.md, whatsapp-bridge/HEARTBEAT.md

Then report results using this exact format:
FILES: <comma-separated list of changed files>
COMMIT: <hash> — <commit message>

If any step fails, report:
STEP_OK: <succeeded step>
STEP_FAIL: <failed step> | <error message>`;

  let currentSessionId = sessionId;
  let lastErr;

  for (const model of EXEC_MODELS) {
    try {
      const opts = { ...baseOpts, model };
      if (currentSessionId) opts.resume = currentSessionId;

      const { text, sessionId: sid } = await runQuery(prompt, opts);

      if (text) {
        console.log(`[claude] exec: ✓ ${model}`);
        const parsed = parseResult(text);
        return { ...parsed, sessionId: sid };
      }

      console.log(`[claude] exec: ${model} returned empty — escalating`);
    } catch (err) {
      lastErr = err;
      console.log(`[claude] exec: ${model} failed (${err.message}) — escalating`);
    }

    currentSessionId = null;
  }

  throw lastErr || new Error('All models failed to execute the plan');
}

module.exports = { generatePlan, executePlan, compactSession, COMPACTION_THRESHOLD };
