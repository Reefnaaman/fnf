#!/usr/bin/env bash
# One-time (and safe to repeat) setup for F&F on this Mac: data dir, persona, .env,
# chat token, and the two launchd services. Never overwrites what the owner edited.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DATA="$REPO/.instinct"
DAEMON="$REPO/daemon"
NODE="${FNF_SETUP_NODE:-$(command -v node || true)}"
[ -n "$NODE" ] || { echo "node not found on PATH (set FNF_SETUP_NODE)" >&2; exit 1; }
NODE_DIR="$(dirname "$NODE")"
AGENTS_DIR="$HOME/Library/LaunchAgents"

mkdir -p "$DATA/logs" "$DATA/workspace/inbound" "$AGENTS_DIR"

# Persona and standing instructions: seeded once, then the owner's.
if [ ! -f "$DATA/PERSONA.md" ]; then cp "$HERE/PERSONA.md" "$DATA/PERSONA.md"; echo "seeded $DATA/PERSONA.md"; fi
if [ ! -f "$DATA/AGENTS.md" ]; then cp "$HERE/AGENTS.md" "$DATA/AGENTS.md"; echo "seeded $DATA/AGENTS.md"; fi

# .env from the example, paths rendered. Existing file is left alone.
if [ ! -f "$REPO/.env" ]; then
  sed -e "s|__REPO__|$REPO|g" "$HERE/env.example" > "$REPO/.env"
  chmod 600 "$REPO/.env"
  echo "wrote $REPO/.env"
fi
if grep -qE '^INSTINCT_CHAT_TOKEN=$' "$REPO/.env"; then
  token="$(openssl rand -hex 24)"
  tmp="$(mktemp)"
  sed -e "s|^INSTINCT_CHAT_TOKEN=$|INSTINCT_CHAT_TOKEN=$token|" "$REPO/.env" > "$tmp" && mv "$tmp" "$REPO/.env" && chmod 600 "$REPO/.env"
  echo "generated INSTINCT_CHAT_TOKEN"
fi

render() {
  sed -e "s|__NODE_DIR__|$NODE_DIR|g" -e "s|__NODE__|$NODE|g" -e "s|__REPO__|$REPO|g" -e "s|__DAEMON__|$DAEMON|g" -e "s|__DATA__|$DATA|g" "$1" > "$2"
  echo "wrote $2"
}
render "$HERE/com.fnf.agent.plist.template" "$AGENTS_DIR/com.fnf.agent.plist"
render "$HERE/com.fnf.whatsapp-daemon.plist.template" "$AGENTS_DIR/com.fnf.whatsapp-daemon.plist"

cat <<MSG

Next:
  1. Fill ANTHROPIC_API_KEY, INSTINCT_OWNER_PHONE (and OPENAI_API_KEY for voice notes) in $REPO/.env
  2. bash deploy/fnf/fnfctl.sh daemon-login      # scan the QR from F&F's WhatsApp account, wait for "ready", Ctrl-C
  3. Text F&F's number once from your phone
  4. bash deploy/fnf/fnfctl.sh owner-chat "<your name as it shows in wa chats>"   # one native Approve dialog
  5. bash deploy/fnf/fnfctl.sh start && bash deploy/fnf/fnfctl.sh status
MSG
