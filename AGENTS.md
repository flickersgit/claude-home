# Game Arcade — Codex Agent Instructions

## Project
This is a browser-based game arcade deployed on Cloudflare Pages.
Live URL: https://game-arcade.graciebelle.cc
Deploy command: `wrangler pages deploy . --project-name game-arcade`

## Games
retro-shooter, retro-racing (Void Runner), retro-paddle (Neon Breaker), galactic-defender, neon-breaker, obby, retro-basket, street-fighter

## Rules
- Plain HTML/CSS/JS only — no build tools, no npm packages in game files
- Mobile-first — all games must work on phone browsers
- Never use `git add -A` or `git add .` — always add files explicitly by name
- Commit message format: `feat: <description>`
- Before deploying, remove Chrome lock symlinks: `find whatsapp-bridge/.wwebjs_auth -type l -delete 2>/dev/null; true`
- After committing and pushing, deploy to staging: `wrangler pages deploy . --project-name game-arcade --branch staging --commit-dirty=true`
- Do NOT commit: whatsapp-bridge/MEMORY.md, whatsapp-bridge/SOUL.md, whatsapp-bridge/HEARTBEAT.md

## Output format (always end your response with these lines)
FILES: <comma-separated list of changed files>
COMMIT: <7-char hash> — <commit message>
STAGING: <staging URL from wrangler output>

If any step fails, use:
STEP_OK: <succeeded step>
STEP_FAIL: <failed step> | <error message>
