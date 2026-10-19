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

# sed treats "&", "\\" and the delimiter specially in a replacement; the folder is literally "F&F".
esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }
R_NODE="$(esc "$NODE")"; R_NODE_DIR="$(esc "$NODE_DIR")"; R_REPO="$(esc "$REPO")"; R_DAEMON="$(esc "$DAEMON")"; R_DATA="$(esc "$DATA")"

# .env from the example, paths rendered. Existing file is left alone.
if [ ! -f "$REPO/.env" ]; then
  sed -e "s|__REPO__|$R_REPO|g" "$HERE/env.example" > "$REPO/.env"
  chmod 600 "$REPO/.env"
  echo "wrote $REPO/.env"
fi
if grep -qE '^INSTINCT_CHAT_TOKEN=$' "$REPO/.env"; then
  token="$(openssl rand -hex 24)"
  tmp="$(mktemp)"
  sed -e "s|^INSTINCT_CHAT_TOKEN=$|INSTINCT_CHAT_TOKEN=$token|" "$REPO/.env" > "$tmp" && mv "$tmp" "$REPO/.env" && chmod 600 "$REPO/.env"
  echo "generated INSTINCT_CHAT_TOKEN"
fi

# Plists are XML: "&" must be "&amp;" inside a <string>. Escape for XML first, then for sed.
xesc() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
X_NODE="$(esc "$(xesc "$NODE")")"; X_NODE_DIR="$(esc "$(xesc "$NODE_DIR")")"; X_REPO="$(esc "$(xesc "$REPO")")"; X_DAEMON="$(esc "$(xesc "$DAEMON")")"; X_DATA="$(esc "$(xesc "$DATA")")"
render() {
  sed -e "s|__NODE_DIR__|$X_NODE_DIR|g" -e "s|__NODE__|$X_NODE|g" -e "s|__REPO__|$X_REPO|g" -e "s|__DAEMON__|$X_DAEMON|g" -e "s|__DATA__|$X_DATA|g" "$1" > "$2"
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
