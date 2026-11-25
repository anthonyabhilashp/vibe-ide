# vibe-ide

A lightweight, obsidian-themed multi-terminal Electron IDE for orchestrating AI coding agents (`claude`, `agy`, `codex`, `copilot`, or plain shells) across up to **4 parallel projects**.

## Highlights

- **4-Project Adaptive Grid**: Run up to 4 project workspaces side-by-side. The focused cell expands automatically so you always have full room to work while keeping background projects visible.
- **Role-Based Tabs (`Design` / `Build` / `Review` / `Test`)**: Every project cell has 4 dedicated persistent shells with color-coded active focus borders (violet, blue, emerald, amber) and per-role prompt actions.
- **Model-Agnostic**: Launch whichever CLI agent performs best for each tab — `agy`, `claude`, `codex`, `copilot`, or plain `zsh`.
- **1-Click Prompt Actions & Cross-Tab Relay**:
  - Customizable prompts (`Design`, `Ticket / Spec`, `Build`, `Review`, `Super Review`, `Test`, `Sync Main`, `MR Description`, `Deploy`) editable right in the app.
  - 1-click **Send to Review** / **Send to Build** relay between tabs.
- **Lightweight Local Voice Mode**:
  - Click-to-toggle mic button positioned right alongside the terminal prompt, with **2-second silence auto-stop** and `Esc` to cancel.
  - Powered by on-demand local `whisper-cli` (`whisper.cpp` + `ggml-base.en.bin`) — **0% idle CPU and 0 MB idle RAM** when not transcribing.
- **Centralized Env & Token Sync**:
  - Manage tokens and base URLs once in **Env** (stored locally with `chmod 600` and synced to `~/.vibe-ide/env`).
  - Automatically shares non-empty variable **names** (never values) with agents on Init so they use `$VAR` directly.
- **Idle Chime Notifications**: Subtle chime + pulsing amber border when a background agent finishes and goes idle (on by default, per-cell mute toggle).
- **Clickable Terminal Links**: Plain-text, soft-wrapped, and OSC-8 URLs open cleanly once in your default browser.

## Quick Start (macOS)

Prerequisites: Node.js 18+ and Homebrew (for `whisper-cpp`).

```bash
git clone https://github.com/anthonyabhilashp/vibe-ide.git
cd vibe-ide
npm install
./restart.sh
```

`npm install` automatically runs `postinstall` to:
1. Rebuild `node-pty` for Electron (`electron-rebuild -f -w node-pty`)
2. Patch `Electron.app` with macOS Microphone usage description (`scripts/patch-permissions.sh`)
3. Install `whisper-cpp` via Homebrew and download `ggml-base.en.bin` to `~/.cache/vibe-ide/` (`scripts/install-whisper.sh`)

## Configuration

All personal configuration stays outside the repo in `~/Library/Application Support/vibe-ide/`:

- **Env (`env.json`, `chmod 600`)**: Click **Env** in the topbar to add your tokens and base URLs (`GITLAB_TOKEN`, `JIRA_TOKEN`, `CONFLUENCE_TOKEN`, `GITLAB_BASE_URL`, `JIRA_BASE_URL`, etc.). Also synced to `~/.vibe-ide/env` — optionally add `[ -f ~/.vibe-ide/env ] && source ~/.vibe-ide/env` to `~/.zshrc` to share them with external terminals.
- **Prompts (`prompts.json`)**: Click **Prompts** in the topbar to customize any role prompt or reset to defaults.
- **State (`state.json`)**: Remembers your open project cells and active tabs across restarts.

## Tech Stack

- [Electron](https://www.electronjs.org/) (frameless `hiddenInset` macOS titlebar)
- [xterm.js](https://xtermjs.org/) + `@xterm/addon-fit`
- [node-pty](https://github.com/microsoft/node-pty)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (local on-demand voice transcription)
