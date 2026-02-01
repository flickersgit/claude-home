# Claude Code Environment Setup

Complete setup instructions for Claude Code on a new computer, including:
- tmux with `cc` shortcut
- Claude Code skills
- Memory log workflow
- GitHub integration

---

## Prerequisites

- macOS or Linux
- Homebrew installed (macOS) or apt/yum (Linux)
- Claude Code CLI installed
- GitHub CLI (`gh`) installed and authenticated

---

## Step 1: Install tmux

### macOS
```bash
brew install tmux
```

### Linux (Debian/Ubuntu)
```bash
sudo apt update && sudo apt install tmux
```

### Linux (Fedora/RHEL)
```bash
sudo dnf install tmux
```

---

## Step 2: Create tmux Configuration

Create `~/.tmux.conf` with the following content:

```bash
# Set prefix to Ctrl+a (easier to reach than Ctrl+b)
unbind C-b
set -g prefix C-a
bind C-a send-prefix

# Enable mouse support
set -g mouse on

# Start windows and panes at 1, not 0
set -g base-index 1
setw -g pane-base-index 1

# Renumber windows when one is closed
set -g renumber-windows on

# Increase scrollback buffer
set -g history-limit 10000

# Faster key repetition
set -s escape-time 0

# Reload config with prefix + r
bind r source-file ~/.tmux.conf \; display "Config reloaded!"

# Split panes with | and -
bind | split-window -h -c "#{pane_current_path}"
bind - split-window -v -c "#{pane_current_path}"

# Navigate panes with vim keys
bind h select-pane -L
bind j select-pane -D
bind k select-pane -U
bind l select-pane -R

# Resize panes with vim keys
bind -r H resize-pane -L 5
bind -r J resize-pane -D 5
bind -r K resize-pane -U 5
bind -r L resize-pane -R 5

# New window in current path
bind c new-window -c "#{pane_current_path}"

# Enable 256 colors
set -g default-terminal "screen-256color"

# Status bar styling
set -g status-style bg=black,fg=white
set -g status-left-length 30
set -g status-right "%H:%M %d-%b"

# Active window styling
setw -g window-status-current-style fg=black,bg=white
```

---

## Step 3: Add `cc` Function to Shell

Detect shell and add the `cc` function.

### For Zsh (~/.zshrc)

Append to `~/.zshrc`:

```bash
# Claude Code with tmux - usage: cc [project-name]
cc() {
  local project="$1"
  local path

  # Define project shortcuts (add more as needed)
  declare -A projects
  projects=(
    ["claude-home"]="$HOME/Documents/Claude Home"
  )

  if [[ -z "$project" ]]; then
    # No argument: use current directory name as session name
    project="${PWD##*/}"
    # Sanitize session name (tmux doesn't like dots/colons)
    project="${project//[.:]/-}"
    path="$(pwd)"
  elif [[ -n "${projects[$project]}" ]]; then
    # Known project shortcut
    path="${projects[$project]}"
  else
    # Treat argument as session name, use current directory
    path="$(pwd)"
  fi

  # Create or attach to tmux session and run claude
  if tmux has-session -t "$project" 2>/dev/null; then
    tmux attach -t "$project"
  else
    tmux new-session -s "$project" -c "$path" "claude; zsh"
  fi
}
```

### For Bash (~/.bashrc)

Append to `~/.bashrc`:

```bash
# Claude Code with tmux - usage: cc [project-name]
cc() {
  local project="$1"
  local path

  # Define project shortcuts (add more as needed)
  declare -A projects
  projects=(
    ["claude-home"]="$HOME/Documents/Claude Home"
  )

  if [[ -z "$project" ]]; then
    # No argument: use current directory name as session name
    project="${PWD##*/}"
    # Sanitize session name (tmux doesn't like dots/colons)
    project="${project//[.:]/-}"
    path="$(pwd)"
  elif [[ -n "${projects[$project]}" ]]; then
    # Known project shortcut
    path="${projects[$project]}"
  else
    # Treat argument as session name, use current directory
    path="$(pwd)"
  fi

  # Create or attach to tmux session and run claude
  if tmux has-session -t "$project" 2>/dev/null; then
    tmux attach -t "$project"
  else
    tmux new-session -s "$project" -c "$path" "claude; bash"
  fi
}
```

---

## Step 4: Reload Shell

```bash
source ~/.zshrc   # or ~/.bashrc
```

---

## Usage

| Command | Behavior |
|---------|----------|
| `cc` | Uses current folder name as session, opens Claude Code |
| `cc claude-home` | Uses predefined shortcut path |
| `cc my-project` | Uses "my-project" as session name, current directory |

---

## tmux Key Bindings Reference

Prefix is `Ctrl+a`

| Keys | Action |
|------|--------|
| `Ctrl+a \|` | Split vertically |
| `Ctrl+a -` | Split horizontally |
| `Ctrl+a h/j/k/l` | Navigate panes |
| `Ctrl+a H/J/K/L` | Resize panes |
| `Ctrl+a c` | New window |
| `Ctrl+a n/p` | Next/previous window |
| `Ctrl+a d` | Detach session |
| `Ctrl+a r` | Reload config |

---

## tmux Notes

- Sessions persist after detaching - reattach with `tmux attach -t <name>`
- List sessions: `tmux ls`
- Kill session: `tmux kill-session -t <name>`

---

# GitHub Setup

## Step 1: Install GitHub CLI

### macOS
```bash
brew install gh
```

### Linux (Debian/Ubuntu)
```bash
sudo apt install gh
```

## Step 2: Authenticate

```bash
gh auth login
```

Follow prompts to authenticate via browser or token.

## Step 3: Configure Git Authentication

```bash
gh auth setup-git
```

This allows git to use gh CLI for HTTPS authentication.

## Step 4: Configure Git Identity (per repo or global)

### Per repository
```bash
git config user.name "your-username"
git config user.email "your-username@users.noreply.github.com"
```

### Global
```bash
git config --global user.name "your-username"
git config --global user.email "your-username@users.noreply.github.com"
```

---

# Claude Code Skills Setup

Skills extend Claude Code with specialized capabilities like document creation, spreadsheet editing, and more.

## Check if Already Installed

First, check if skills are already configured:

```bash
ls ~/.claude/plugins/installed_plugins.json 2>/dev/null && echo "Skills may already be installed - check file contents"
```

If skills are already installed, **skip this section**.

## Step 1: Install Skills from Anthropic Repository

In Claude Code, run:

```
/install-plugin anthropics/skills document-skills
/install-plugin anthropics/skills example-skills
```

Or use the CLI:

```bash
claude /install-plugin anthropics/skills document-skills
claude /install-plugin anthropics/skills example-skills
```

## Step 2: Enable Skills

Skills should auto-enable after installation. Verify in `~/.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "document-skills@anthropic-agent-skills": true,
    "example-skills@anthropic-agent-skills": true
  }
}
```

## Available Skills

After installation, you'll have access to:

| Skill | Description |
|-------|-------------|
| `pdf` | Create, edit, merge PDFs |
| `docx` | Word document creation and editing |
| `xlsx` | Spreadsheet with formulas and formatting |
| `pptx` | Presentation creation |
| `frontend-design` | Build web components and pages |
| `canvas-design` | Create visual art and posters |
| `algorithmic-art` | Generative art with p5.js |
| `mcp-builder` | Build MCP servers |
| `skill-creator` | Create custom skills |

## Verification

Test a skill by asking Claude Code:
```
Create a simple PDF with "Hello World"
```

---

# Memory Log Setup

The memory log system maintains conversation continuity across Claude Code sessions.

## Directory Structure

```
Claude Home/
├── claude.md                      # Project config with workflow instructions
├── memory_log/
│   ├── conversation_20260201.md   # Daily logs (YYYYMMDD format)
│   └── conversation_20260202.md
└── setup/
    └── tmux-setup.md              # This file
```

## Step 1: Create Memory Log Directory

```bash
mkdir -p "$HOME/Documents/Claude Home/memory_log"
```

## Step 2: Create claude.md

Create `$HOME/Documents/Claude Home/claude.md` with the following content:

```markdown
# Claude Home

This project serves as the central configuration hub for setting up Claude Code across all projects.

## Purpose

- Configure and maintain Claude Code settings that apply globally
- Store shared configurations, preferences, and tooling setup
- Serve as the base environment for Claude Code workflows

## Structure

- `memory_log/` - Conversation logs and session summaries (format: `conversation_YYYYMMDD.md`)

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
```

## Step 3: Initialize Git Repository

```bash
cd "$HOME/Documents/Claude Home"
git init
```

## Step 4: Create .gitignore

Create `.gitignore`:

```
# OS
.DS_Store

# Editor
*.swp
*.swo
*~

# Environment
.env
.env.local
```

## Step 5: Create GitHub Repository

```bash
cd "$HOME/Documents/Claude Home"
gh repo create claude-home --private --source=. --description "Central configuration hub for Claude Code"
```

## Step 6: Initial Commit and Push

```bash
git add .
git commit -m "Initial commit: Claude Home setup"
git push -u origin main
```

---

# Quick Setup (All-in-One)

For Claude Code to run on a new machine, execute these steps in order:

1. Install tools: `brew install tmux gh`
2. Authenticate: `gh auth login && gh auth setup-git`
3. Clone repo: `gh repo clone <username>/claude-home "$HOME/Documents/Claude Home"`
4. Create tmux config: Copy content from Step 2 to `~/.tmux.conf`
5. Add `cc` function: Append to `~/.zshrc` or `~/.bashrc`
6. Reload shell: `source ~/.zshrc`
7. Install skills (if not already installed):
   ```bash
   claude /install-plugin anthropics/skills document-skills
   claude /install-plugin anthropics/skills example-skills
   ```

---

# Verification

After setup, verify everything works:

```bash
# Check tmux
tmux -V

# Check GitHub CLI
gh auth status

# Check skills installed
cat ~/.claude/settings.json

# Test cc shortcut
cc claude-home
```

In Claude Code, test skills:
```
Create a simple test.pdf with "Setup complete"
```
