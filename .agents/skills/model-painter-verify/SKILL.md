---
name: model-painter-verify
description: >-
  Run Angular production builds, headless Karma unit tests, dev server startup,
  and offline Playwright E2E verification for the model-painter workspace.
  Use whenever building, running `ng test`, starting `pnpm run start`, or
  verifying UI changes in Chromium in this repository.
---

# Model Painter Build, Unit Test & Browser Verification

## 1. Locate Node.js (nvm)
Non-interactive shells may not have nvm on `PATH`. Prefix Node/pnpm commands with the installed nvm bin directory:

```bash
NODE_BIN=$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -n 1)
export PATH="$NODE_BIN:$PATH"
```

## 2. Production Build
```bash
PATH="$NODE_BIN:$PATH" pnpm run build
```

## 3. Headless Karma Unit Tests
Karma requires `CHROME_BIN`, writable XDG directories in `/tmp`, and `--no-sandbox` when running inside a Linux sandbox. Locate Playwright's Chromium binary and wrap it in `/tmp`:

```bash
CHROME_EXE=$(find "$HOME/.cache/ms-playwright" -name chrome -type f 2>/dev/null | head -n 1)
printf '#!/bin/sh\nexec "%s" --no-sandbox "$@"\n' "$CHROME_EXE" > /tmp/chrome-no-sandbox.sh
chmod +x /tmp/chrome-no-sandbox.sh

XDG_CONFIG_HOME=/tmp/chrome-cfg \
XDG_CACHE_HOME=/tmp/chrome-cache \
CHROME_BIN=/tmp/chrome-no-sandbox.sh \
PATH="$NODE_BIN:$PATH" \
pnpm exec ng test --watch=false --browsers=ChromeHeadless

rm -f /tmp/chrome-no-sandbox.sh
```

## 4. Dev Server Startup
With `pnpm`, do **not** insert an extra `--` before `--port` (Angular CLI rejects the extra positional arg):

```bash
PATH="$NODE_BIN:$PATH" pnpm run start --port 4204
```

## 5. Sandboxed Playwright Verification (Fallback when Browser MCP is Unavailable)
If the `browser` subagent / `chrome_devtools` MCP is unavailable (e.g., `npx` not on system `PATH`):
1. Build first (`pnpm run build`).
2. Run a single Node script that both serves `dist/model-painter/browser` (with SPA fallback to `index.html`) on `127.0.0.1:0` and launches Playwright Chromium in the **same process** (each sandboxed command has an isolated loopback namespace):
   - Resolve Playwright from the workspace: `createRequire('/home/korol/Documents/model-painter/package.json')('playwright')`.
   - Launch with `executablePath` set to the discovered `~/.cache/ms-playwright/.../chrome` and `args: ['--no-sandbox']`.
   - Set `XDG_CONFIG_HOME=/tmp/chrome-cfg XDG_CACHE_HOME=/tmp/chrome-cache`.
3. Note: Remote CDN/Firestore calls will log `net::ERR_INTERNET_DISCONNECTED` when offline inside the sandbox; assert `pageErrors.length === 0` and verify UI behavior and screenshots directly.
