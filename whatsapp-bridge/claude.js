'use strict';

// ---------------------------------------------------------------------------
// Claude integration — two-phase plan / execute using Claude Code SDK
// ---------------------------------------------------------------------------

const path = require('path');

const PROJECT_DIR = process.env.PROJECT_DIR || path.join(__dirname, '..');

// Lazy-load the SDK so missing dep gives a clear error at call time
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

const SYSTEM_PROMPT_APPEND = `
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

// Sanitize error text before sending to WhatsApp
function sanitize(text, projectDir) {
  if (!text) return text;
  let s = text
    // Strip API keys
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[API_KEY]')
    // Replace absolute project dir with relative placeholder
    .replace(new RegExp(projectDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '~')
    // Replace other absolute paths that look like home dirs
    .replace(/\/Users\/[^/\s]+/g, '~');
  // Truncate
  if (s.length > 1500) {
    s = s.slice(0, 1497) + '…';
  }
  return s;
}

// Parse Claude's structured output into a result object
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
      result.steps.push({ ok: false, label: parts[0].trim(), error: sanitize((parts[1] || '').trim(), PROJECT_DIR) });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Phase 1: generate a plan (read-only tools)
// ---------------------------------------------------------------------------
async function generatePlan(instruction, sessionId) {
  const { query } = getSdk();
  let planText = '';
  let newSessionId = sessionId;

  const options = {
    cwd: PROJECT_DIR,
    allowedTools: ['Read', 'Glob', 'Grep'],
    permissionMode: 'default',
    maxTurns: 12,
    systemPrompt: SYSTEM_PROMPT_APPEND,
  };

  if (sessionId) {
    options.resume = sessionId;
  }

  const prompt = sessionId
    ? `New instruction: ${instruction}\n\nDescribe what you would do to fulfill this request. List the files you'd create or modify, and what changes you'd make. Be concise — this is for a WhatsApp confirmation message.`
    : `You are working on the game-arcade project. The user wants you to: ${instruction}\n\nDescribe what you would do to fulfill this request. List the files you'd create or modify, and what changes you'd make. Be concise — this is for a WhatsApp confirmation message.`;

  for await (const msg of query({ prompt, options })) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      newSessionId = msg.session_id;
    }
    if (msg.type === 'result' && msg.subtype === 'success') {
      planText = msg.result;
    }
    if (msg.type === 'result' && msg.subtype === 'error_max_turns') {
      planText = msg.result || 'Could not generate a complete plan.';
    }
  }

  return { plan: sanitize(planText, PROJECT_DIR), sessionId: newSessionId };
}

// ---------------------------------------------------------------------------
// Phase 2: execute the plan (full tools)
// ---------------------------------------------------------------------------
async function executePlan(instruction, sessionId) {
  const { query } = getSdk();
  let resultText = '';
  let newSessionId = sessionId;

  const options = {
    cwd: PROJECT_DIR,
    allowedTools: ['Read', 'Edit', 'Write', 'MultiEdit', 'Bash', 'Glob', 'Grep'],
    permissionMode: 'bypassPermissions',
    allowedDangerouslySkipPermissions: true,
    maxTurns: 30,
    systemPrompt: SYSTEM_PROMPT_APPEND,
  };

  if (sessionId) {
    options.resume = sessionId;
  }

  const prompt = `The user confirmed the plan. Now execute it.

Original instruction: ${instruction}

After making all file changes:
1. Run: git add <all changed files>
2. Run: git commit -m "feat: <brief description>"
3. Run: git push
4. Run: wrangler pages deploy . --project-name game-arcade

Then report results using this exact format:
FILES: <comma-separated list of changed files>
COMMIT: <hash> — <commit message>

If any step fails, report:
STEP_OK: <succeeded step>
STEP_FAIL: <failed step> | <error message>`;

  for await (const msg of query({ prompt, options })) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      newSessionId = msg.session_id;
    }
    if (msg.type === 'result' && msg.subtype === 'success') {
      resultText = msg.result;
    }
    if (msg.type === 'result' && msg.subtype === 'error_max_turns') {
      resultText = msg.result || 'Execution did not complete within turn limit.';
    }
  }

  const parsed = parseResult(resultText);
  return { ...parsed, sessionId: newSessionId };
}

module.exports = { generatePlan, executePlan };
