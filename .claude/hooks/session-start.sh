#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# pnpm is pinned by package.json "packageManager"; corepack selects that version.
corepack enable >/dev/null 2>&1 || true

# dsh-client-ui-sidebar-documentpreview depends on a tarball hosted at
# cdn.sheetjs.com. If the environment's network policy blocks that host, install
# every other workspace package and warn instead of failing the session.
if curl -fsS -m 10 -o /dev/null -I https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz 2>/dev/null; then
  pnpm install
else
  echo "WARNING: cdn.sheetjs.com is unreachable; skipping @deepseek-ai/dsh-client-ui-sidebar-documentpreview." >&2
  echo "Add cdn.sheetjs.com to the environment's allowed domains for a full install." >&2
  pnpm install --filter '!@deepseek-ai/dsh-client-ui-sidebar-documentpreview'
fi
