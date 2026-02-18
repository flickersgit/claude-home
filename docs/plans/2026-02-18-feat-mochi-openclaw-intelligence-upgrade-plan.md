---
title: "feat: Upgrade Mochi with OpenClaw intelligence patterns"
type: feat
status: completed
date: 2026-02-18
---

# feat: Upgrade Mochi with OpenClaw Intelligence Patterns

## Overview

Mochi currently works as a reactive WhatsApp→Claude Code bridge — it receives an instruction, plans, confirms, executes, and forgets everything on the next restart. By studying **OpenClaw** (the open-source autonomous AI agent framework with 200k+ GitHub stars), five targeted improvements can make Mochi meaningfully smarter without a full rewrite.

The improvements are ordered from lowest to highest architectural risk and can be shipped incrementally.

---

## What is OpenClaw?

OpenClaw is an open-source autonomous AI agent daemon that wraps any LLM in a persistent, memory-aware, proactively scheduled operating system. Its key architectural insight: **the LLM provides intelligence; the framework provides memory, context, and autonomy**.

Key patterns studied:
- **Layered system prompt assembly** from files on disk (SOUL.md, AGENTS.md, MEMORY.md)
- **Three-tier memory** (session history → compacted summary → long-term MEMORY.md + vector DB)
- **Heartbeat daemon** for proactive monitoring via HEARTBEAT.md checklists
- **Persistent session storage** (JSONL per chatId, survives restarts)
- **Session key naming conventions** for isolation between session types

References:
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [You Could've Invented OpenClaw](https://gist.github.com/dabit3/bc60d3bea0b02927995cd9bf53c3db32) — best architectural walkthrough
- [nanobot: lightweight clone](https://github.com/HKUDS/nanobot) — minimal implementation for study

---

## Problem Statement

Mochi loses all context on every restart:
- `claudeSessionId` is cleared at boot — Claude has no memory of prior work
- System prompt is hardcoded in `claude.js` — personality/context requires a code deploy to change
- No persistent facts about the project, user preferences, or prior decisions
- Purely reactive — only acts when a message arrives, never checks proactively
- If `executePlan` hangs, the bot is stuck in `executing` state forever

---

## Proposed Solution

Five features shipped as independent phases, each building on the previous:

| Phase | Feature | Risk | Value |
|---|---|---|---|
| 1 | SOUL.md — editable system prompt | Low | Personality/context editable without redeploy |
| 2 | MEMORY.md — persistent facts | Low | Knowledge survives sessions |
| 3 | Persistent `claudeSessionId` | Medium | Conversation context survives restarts |
| 4 | Context compaction | Medium | Long conversations stay coherent |
| 5 | Heartbeat daemon | High | Proactive monitoring and alerts |
| 6 | Model routing — Haiku → Sonnet → Opus | Low | Cost efficiency + automatic escalation to smarter model |

---

## Technical Approach

### File Layout

All Mochi-specific files live in `whatsapp-bridge/` — **not** in `PROJECT_DIR` — to avoid accidental git commits and keep Claude's working area clean.

```
whatsapp-bridge/
├── SOUL.md          # Mochi's personality, project context, output format rules
├── MEMORY.md        # Persistent facts appended by Claude after executions
├── HEARTBEAT.md     # Checklist of proactive checks (shell commands + alert conditions)
├── memory/          # Daily logs (optional, future)
│   └── 2026-02-18.md
├── bot.js
├── claude.js        # Updated to read SOUL.md + MEMORY.md, handle compaction
├── state.js         # Updated to persist claudeSessionId
├── mochi.js         # New: heartbeat alert templates, memory query templates
└── heartbeat.js     # New: background checker, HEARTBEAT.md parser
```

### Design Decisions (from SpecFlow analysis)

**Session staleness**: When a restored `claudeSessionId` is rejected by the SDK, catch the error, clear the session ID, retry once as a fresh session, and send the user a one-time notice: "I lost our conversation context — starting a fresh session."

**SOUL.md missing**: Fall back to the hardcoded `SYSTEM_PROMPT_APPEND` string. Never fail silently to an empty system prompt (which would break output format parsing).

**SOUL.md size cap**: Truncate at 3000 characters on read with a warning logged. MEMORY.md capped at 4000 characters (oldest entries trimmed first via a simple line-count limit).

**Heartbeat during execution**: Skip sending alerts when `status === 'executing'`; queue them and deliver after execution completes.

**Heartbeat alerts are informational only** — no yes/no prompts that could be mis-parsed by the state machine as plan confirmations.

**Execution timeout**: Add a 15-minute timeout on `executePlan` that clears the `executing` state and sends the user an error message if Claude doesn't respond.

**Compaction strategy**: Message-count heuristic (every 20 interactions with the same `claudeSessionId`), not token-count based (SDK doesn't expose reliable token counts in the streaming loop).

**MEMORY.md in executePlan**: Explicitly exclude `whatsapp-bridge/MEMORY.md` from `git add` in the execution prompt. Add it to `.gitignore` in `whatsapp-bridge/`.

---

## Phase 1: SOUL.md — Editable System Prompt

### What changes

`claude.js`: Replace hardcoded `SYSTEM_PROMPT_APPEND` with a function that reads `whatsapp-bridge/SOUL.md` at call time.

```
// claude.js
function loadSoul() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'SOUL.md'), 'utf8');
    return raw.slice(0, 3000); // cap at 3000 chars
  } catch {
    return FALLBACK_SYSTEM_PROMPT; // hardcoded string, current value
  }
}
```

`SOUL.md` is created as the authoritative source of Mochi's identity, replacing the inline string in `claude.js`. It includes:
- Mochi's personality and name
- Project directory and deploy command
- Git workflow
- WhatsApp output constraints (no markdown, plain text only)
- Structured output format rules (FILES:, COMMIT:, STEP_OK:, STEP_FAIL:)
- Instruction to not write to `MEMORY.md` unless specifically needed

### Acceptance Criteria

- [ ] `whatsapp-bridge/SOUL.md` file created with full system prompt content
- [ ] `claude.js` reads SOUL.md on every `generatePlan`/`executePlan` call
- [ ] If SOUL.md is missing, falls back to hardcoded string and logs a warning
- [ ] SOUL.md is in `.gitignore` (so edits don't auto-deploy via git)
- [ ] Editing SOUL.md changes Mochi's behavior on the next message, no restart needed

---

## Phase 2: MEMORY.md — Persistent Facts

### What changes

`claude.js`: Inject MEMORY.md contents into the system prompt on every `generatePlan` call.

`SOUL.md`: Add instruction for Claude to append important learnings to `whatsapp-bridge/MEMORY.md` at the end of `executePlan` (as a Bash `echo >> ...` call), but only when something genuinely new was learned.

`mochi.js`: Add `isMemoryQuery(text)` matcher for "what do you remember?" / "show your memory" / "forget everything". Add `memoryReport(contents)` and `memoryCleared()` templates.

`bot.js`: Handle memory query commands in `handleMessage` before the status/greeting checks.

```
// claude.js — injected into system prompt:
const memory = loadMemory(); // reads MEMORY.md, capped at 4000 chars
const systemPrompt = `${loadSoul()}\n\n## What I remember:\n${memory || 'Nothing yet.'}`;
```

### MEMORY.md format

```markdown
# Mochi Memory

- 2026-02-18: The game-arcade project uses Cloudflare Pages, deployed via wrangler CLI. Git is not linked to Cloudflare auto-deploy.
- 2026-02-18: The owner prefers brief WhatsApp replies. No markdown.
- 2026-02-18: retro-shooter, retro-racing, retro-paddle, galactic-defender, neon-breaker are the current games.
```

### Acceptance Criteria

- [ ] `whatsapp-bridge/MEMORY.md` created with seed facts about the project
- [ ] `claude.js` injects MEMORY.md into system prompt on every call
- [ ] MEMORY.md capped at 4000 characters; oldest lines trimmed if over limit
- [ ] SOUL.md instructs Claude to append new facts during execution when appropriate
- [ ] "what do you remember?" returns MEMORY.md content via WhatsApp
- [ ] "forget everything" clears MEMORY.md (with confirmation prompt)
- [ ] MEMORY.md is in `.gitignore`

---

## Phase 3: Persistent `claudeSessionId`

### What changes

`state.js`: Remove the `claudeSessionId: null` override in `loadFromDisk()` — allow the session ID to be restored from `sessions.json`.

`claude.js`: Add stale-session error handling. If the SDK throws an error that indicates an invalid session ID, catch it, clear the session ID from state, and retry once as a fresh session.

```
// claude.js — in generatePlan():
try {
  for await (const msg of query({ prompt, options })) { ... }
} catch (err) {
  if (isStaleSessionError(err) && options.resume) {
    // Clear session ID and retry fresh
    setState(chatId, { claudeSessionId: null });
    options = { ...options, resume: undefined };
    for await (const msg of query({ prompt, options })) { ... }
    await client.sendMessage(chatId, mochi.sessionReset());
    return;
  }
  throw err;
}
```

### Acceptance Criteria

- [ ] `claudeSessionId` survives a `pm2 restart` and is restored on next use
- [ ] If the restored session ID is rejected by the SDK, Mochi retries as a fresh session
- [ ] User receives a one-time "lost conversation context, starting fresh" notice on session reset
- [ ] `mochi.js` has a `sessionReset()` message template
- [ ] No regression: first-time users with no saved session still work correctly

---

## Phase 4: Context Compaction

### What changes

`state.js`: Add `interactionCount: number` to session state, incremented on every `generatePlan` call.

`claude.js`: After `generatePlan`, check if `interactionCount` has hit the threshold (default: 20). If so, run a compaction step:

1. Make a short separate Claude call (read-only, `maxTurns: 3`) asking it to summarize the session and write key facts to MEMORY.md
2. Clear the `claudeSessionId` in state (force fresh session next call)
3. Reset `interactionCount` to 0

The compaction prompt is a named constant, not inline:

```javascript
const COMPACTION_PROMPT = `You have had a long conversation about the game-arcade project.
Before we start fresh:
1. Review what was accomplished and learned.
2. Append any important facts or decisions to whatsapp-bridge/MEMORY.md (one line per fact, format: "- YYYY-MM-DD: <fact>").
3. Reply: COMPACTED

Do not make any other file changes.`;
```

`mochi.js`: Add `compacting()` template ("📝 Archiving context...") sent to user before compaction runs.

### Acceptance Criteria

- [ ] `interactionCount` increments on each `generatePlan` call and persists to `sessions.json`
- [ ] After 20 interactions, compaction runs automatically before the next plan
- [ ] User sees "📝 Archiving context..." before compaction, then continues normally
- [ ] Compaction appends to MEMORY.md and starts a fresh session
- [ ] `COMPACTION_THRESHOLD` is a named constant in `claude.js`, easily tunable
- [ ] Compaction errors are caught and logged; the session continues even if compaction fails

---

## Phase 5: Heartbeat Daemon

### What changes

`heartbeat.js` (new file): Background checker that:
- Runs on a configurable interval (default: every 30 minutes, set in `.env` as `HEARTBEAT_INTERVAL_MS`)
- Reads `whatsapp-bridge/HEARTBEAT.md` to get the list of checks
- Runs each check (deterministic shell commands, not Claude calls)
- Queues alerts if status is `executing`, delivers after execution completes
- Deduplicates: same alert not sent twice within 2 hours
- Respects quiet hours (configurable `HEARTBEAT_QUIET_HOURS=22:00-08:00` in `.env`)

`HEARTBEAT.md` format: simple YAML-fenced check definitions:

```markdown
# Mochi Heartbeat Checks

## site-health
command: curl -sf https://game-arcade.graciebelle.cc > /dev/null
alert: "⚠️ Site is down: game-arcade.graciebelle.cc"

## git-uncommitted
command: git -C "$PROJECT_DIR" status --porcelain
alert_if_output: "⚠️ Uncommitted changes in project:\n{output}"

## disk-space
command: df -h / | awk 'NR==2 {print $5}' | tr -d '%'
alert_if_gt: 90
alert: "⚠️ Disk is {value}% full"
```

`bot.js`: Import `heartbeat.js`, pass it the `client` and `getState` references. Heartbeat calls `client.sendMessage(OWNER_NUMBER, alert)` directly.

`mochi.js`: Add `heartbeatAlert(checkName, message)` template.

### Alert format

Heartbeat alerts are **informational only** — no yes/no prompts. Example:

```
⚠️ Heartbeat: site-health
game-arcade.graciebelle.cc is not responding.

To investigate, just tell me what to check.
```

This ensures the user's reply is a new instruction, not a confirmation, and routes correctly through the state machine.

### Acceptance Criteria

- [ ] `heartbeat.js` created with HEARTBEAT.md parser and check runner
- [ ] `whatsapp-bridge/HEARTBEAT.md` created with site-health, git-uncommitted, and disk-space checks
- [ ] Alerts sent only when `status !== 'executing'`; queued otherwise
- [ ] Same alert not sent twice within 2 hours (deduplication by check name + timestamp)
- [ ] Quiet hours respected (no alerts between 22:00–08:00 local time by default)
- [ ] Heartbeat skipped entirely if `HEARTBEAT_INTERVAL_MS=0` in `.env`
- [ ] Alert format is purely informational, no yes/no prompts
- [ ] `heartbeat.js` in `.gitignore`? No — it's code, should be committed. HEARTBEAT.md should be in `.gitignore`

---

## Phase 6: Model Routing — Haiku → Sonnet → Opus

### What changes

`claude.js`: Replace single hardcoded model with a three-tier cascade. Each phase tries models in order, escalating on failure or empty output.

```
generatePlan:  Haiku  →  Sonnet 4.6  →  Opus 4.6
executePlan:   Sonnet 4.6  →  Opus 4.6
```

Haiku is skipped for execution — it lacks the capability for reliable file edits, git commands, and deploys.

The SDK already supports `model` as a first-class option (confirmed: it passes `--model` to the CLI). A manual retry loop handles the three-tier cascade because the SDK's built-in `fallbackModel` only covers one level.

### Escalation rules

| Condition | Action |
|---|---|
| SDK throws (crash, exit code 1, etc.) | Escalate to next model |
| Returned plan text is blank or < 30 chars | Escalate to next model |
| `error_max_turns` with no useful output | Escalate to next model |
| All models exhausted | Throw original error |

On escalation: clear `sessionId` (can't resume a failed session) and start fresh with the next model.

### Implementation sketch

```javascript
// claude.js

const PLAN_MODELS  = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6'];
const EXEC_MODELS  = ['claude-sonnet-4-6', 'claude-opus-4-6'];

async function runQuery(prompt, options) {
  const { query } = getSdk();
  let text = '', sessionId = options.resume || null;
  for await (const msg of query({ prompt, options })) {
    if (msg.type === 'system' && msg.subtype === 'init') sessionId = msg.session_id;
    if (msg.type === 'result') text = msg.result || text;
  }
  return { text, sessionId };
}

async function generatePlan(instruction, sessionId) {
  let currentSessionId = sessionId, lastErr;
  for (const model of PLAN_MODELS) {
    try {
      const opts = { ...BASE_PLAN_OPTS, model };
      if (currentSessionId) opts.resume = currentSessionId;
      const { text, sessionId: sid } = await runQuery(planPrompt(instruction, currentSessionId), opts);
      if (text && text.length >= 30) {
        console.log(`[claude] plan: ✓ ${model}`);
        return { plan: sanitize(text), sessionId: sid };
      }
      console.log(`[claude] plan: ${model} returned empty, escalating`);
    } catch (err) {
      lastErr = err;
      console.log(`[claude] plan: ${model} failed — escalating`);
    }
    currentSessionId = null; // fresh session on escalation
  }
  throw lastErr || new Error('All models failed to generate a plan');
}
```

### Logging

Each successful call logs which model was used:
```
[claude] plan: ✓ claude-haiku-4-5-20251001
[claude] plan: claude-haiku-4-5-20251001 failed — escalating
[claude] plan: ✓ claude-sonnet-4-6
[claude] exec: ✓ claude-sonnet-4-6
[claude] exec: claude-sonnet-4-6 failed — escalating to opus
[claude] exec: ✓ claude-opus-4-6
```

### Acceptance Criteria

- [ ] `generatePlan` tries Haiku first; escalates to Sonnet 4.6, then Opus 4.6 on failure
- [ ] `executePlan` tries Sonnet 4.6 first; escalates to Opus 4.6 on failure
- [ ] Escalation clears the sessionId (fresh session per model attempt)
- [ ] Which model was used is logged to `out.log` on every call
- [ ] If all models fail, the original error is surfaced to the user (not swallowed)
- [ ] Model names are named constants, easy to update when new models release

---

## Files to Create / Modify

| File | Action | Phase |
|---|---|---|
| `whatsapp-bridge/SOUL.md` | Create | 1 |
| `whatsapp-bridge/claude.js` | Modify — read SOUL.md, MEMORY.md; add compaction | 1, 2, 4 |
| `whatsapp-bridge/MEMORY.md` | Create | 2 |
| `whatsapp-bridge/mochi.js` | Modify — add memory query matchers + templates | 2, 3 |
| `whatsapp-bridge/bot.js` | Modify — memory query handler, heartbeat init, execution timeout | 2, 5 |
| `whatsapp-bridge/state.js` | Modify — restore claudeSessionId, add interactionCount | 3, 4 |
| `whatsapp-bridge/heartbeat.js` | Create | 5 |
| `whatsapp-bridge/HEARTBEAT.md` | Create | 5 |
| `whatsapp-bridge/.gitignore` | Modify — add SOUL.md, MEMORY.md, HEARTBEAT.md | 1 |
| `whatsapp-bridge/.env.example` | Modify — add HEARTBEAT_INTERVAL_MS, HEARTBEAT_QUIET_HOURS, CLAUDE_PATH | 5 |
| `whatsapp-bridge/claude.js` | Modify — add PLAN_MODELS/EXEC_MODELS cascade, runQuery() helper | 6 |

---

## Acceptance Criteria (Full)

### Phase 1 — SOUL.md
- [ ] Editing `SOUL.md` changes Mochi's behavior on the next message without restart
- [ ] Missing SOUL.md → fallback to hardcoded string, warning logged

### Phase 2 — MEMORY.md
- [ ] "what do you remember?" returns MEMORY.md contents
- [ ] "forget everything" clears MEMORY.md with a "Are you sure? (yes/no)" prompt
- [ ] Claude appends facts during execution when genuinely new information arises
- [ ] MEMORY.md not committed to git

### Phase 3 — Persistent Session
- [ ] `pm2 restart mochi` → next message continues Claude session
- [ ] Stale session → automatic retry as fresh session with notice to user

### Phase 4 — Context Compaction
- [ ] After 20 interactions, compaction runs and MEMORY.md is updated
- [ ] User sees brief notification, no disruption to workflow

### Phase 6 — Model Routing
- [ ] Haiku used first for plan generation; escalates automatically on failure
- [ ] Sonnet 4.6 used first for execution; escalates to Opus on failure
- [ ] Model used is logged to out.log on every call
- [ ] All three models defined as named constants in `claude.js`

### Phase 5 — Heartbeat
- [ ] Site-down alert sent within one interval (30 min) of `game-arcade.graciebelle.cc` going offline
- [ ] No duplicate alerts within 2 hours
- [ ] No alerts during quiet hours
- [ ] No alerts while execution is in progress

---

## Dependencies & Risks

**Risk 1 — SOUL.md breaks output format parsing**
If SOUL.md is edited and the output format instructions (FILES:, COMMIT:) are accidentally removed, `parseResult()` in `claude.js` will return empty results and all executions will look like failures. Mitigation: add a validation step in `loadSoul()` that checks for required keywords and warns if absent.

**Risk 2 — MEMORY.md grows unbounded**
Without a trim policy, MEMORY.md grows forever. Mitigation: enforce 4000 character cap, trimming oldest lines.

**Risk 3 — Heartbeat WhatsApp rate limiting**
Multiple rapid alerts could trigger a WhatsApp ban. Mitigation: 2-hour deduplication window + quiet hours + batch multiple alerts into one message per interval.

**Risk 4 — Stale session detection is fragile**
The Claude Code SDK does not document a specific error type for "invalid session ID." If the SDK changes its error messages, the stale-session detection could silently fail. Mitigation: wrap the retry in a general catch with a `retried` flag; log unrecognized session errors.

---

## References

### Internal
- `whatsapp-bridge/claude.js` — current system prompt, query loop, parseResult
- `whatsapp-bridge/state.js:30-60` — current persistence, claudeSessionId clearing
- `whatsapp-bridge/mochi.js` — intent matchers and message templates
- `docs/brainstorms/2026-02-18-whatsapp-claude-bridge-brainstorm.md` — original design decisions

### External
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [You Could've Invented OpenClaw](https://gist.github.com/dabit3/bc60d3bea0b02927995cd9bf53c3db32)
- [nanobot: minimal OpenClaw clone](https://github.com/HKUDS/nanobot)
- [OpenClaw Session Management](https://docs.openclaw.ai/concepts/session)
- [OpenClaw System Prompt Layering](https://docs.openclaw.ai/concepts/system-prompt)
