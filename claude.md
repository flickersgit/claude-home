# Claude Home

This project serves as the central configuration hub for setting up Claude Code across all projects.

## Purpose

- Configure and maintain Claude Code settings that apply globally
- Store shared configurations, preferences, and tooling setup
- Serve as the base environment for Claude Code workflows

## Structure

- `memory_log/` - Conversation logs and session summaries (format: `conversation_YYYYMMDD.md`)

---

## Projects

### Game Arcade (`game-arcade.graciebelle.cc`)

- **Directory**: `/Users/statpods/Documents/Claude Home`
- **Cloudflare Pages project**: `game-arcade`
- **Git remote**: `https://github.com/flickersgit/claude-home.git` (NOT linked to Cloudflare — no auto-deploy)
- **Deploy command**:
  ```bash
  wrangler pages deploy . --project-name game-arcade
  ```
- After deploying, confirm at `game-arcade.graciebelle.cc`

---

## Workflow Instructions

### On Session Start (REQUIRED)

At the very beginning of each session, before responding to the user:

1. Silently read today's memory log: `memory_log/conversation_YYYYMMDD.md`
2. Silently read yesterday's memory log: `memory_log/conversation_YYYYMMDD.md` (previous day)
3. If logs exist, use context to maintain continuity - no need to summarize to user unless asked
4. If no logs exist, proceed normally

### Before Session End

Update memory log when:
- User says goodbye, exit, done, end session, etc.
- User explicitly asks to save/log the conversation
- **Proactive**: If significant work was done, offer to update the log before ending

Actions:
1. Check if `memory_log/conversation_YYYYMMDD.md` exists for today
2. **Create** if not exists, **append** if exists (add horizontal rule `---` before new content)
3. Include:
   - Timestamp of session
   - Topics discussed
   - Tools/software installed or configured
   - Files created, modified, or deleted
   - User preferences observed
   - Pending items or follow-ups

### Git Commit & Push (After Updating Memory Log)

After creating/updating the memory log:

1. Stage the memory log file:
   ```bash
   git add memory_log/conversation_YYYYMMDD.md
   ```

2. Commit with descriptive message:
   ```bash
   git commit -m "log: update conversation YYYY-MM-DD"
   ```

3. Push to remote:
   ```bash
   git push
   ```

**Notes:**
- Ask user for confirmation before pushing if there are other uncommitted changes
- If push fails (no remote, auth issues), inform user but don't block session end
- Include any other changed files in the commit if user approves

### Log Format Template

```markdown
# Conversation Log - [Full Date]

## Session [N] - [HH:MM]

### Summary
Brief overview of what was accomplished

### Details
- Detailed bullet points

### Files Changed
| File | Action |
|------|--------|
| path/to/file | created/modified/deleted |

### Notes
Any preferences or follow-ups
```
