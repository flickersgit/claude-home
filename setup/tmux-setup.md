# tmux + Claude Code Setup Instructions

Instructions for Claude Code to set up tmux with the `cc` shortcut on a new computer.

---

## Prerequisites

- macOS or Linux
- Homebrew installed (macOS) or apt/yum (Linux)
- Claude Code CLI installed

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

## Notes

- Sessions persist after detaching - reattach with `tmux attach -t <name>`
- List sessions: `tmux ls`
- Kill session: `tmux kill-session -t <name>`
