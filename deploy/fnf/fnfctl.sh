#!/usr/bin/env bash
# Control F&F's two services (the agent and its WhatsApp daemon) and the one-time steps.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DAEMON="$REPO/daemon"
DATA="$REPO/.instinct"
AGENT=com.fnf.agent
WA=com.fnf.whatsapp-daemon
DOMAIN="gui/$(id -u)"
PLISTS="$HOME/Library/LaunchAgents"
WABIN="${FNF_WA_BIN:-$DAEMON/bin/wa}"

usage() {
  cat <<MSG
usage: fnfctl.sh <command>
  start            load both services (daemon first), now and at login
  daemon-start     load only the daemon and wait until it is ready (before owner-chat)
  stop             unload both services
  restart          stop, then start
  status           launchd state of both services, daemon readiness, agent /status
  logs             follow the agent log
  daemon-logs      follow the daemon log
  daemon-login     run the daemon in the foreground for the one-time QR link (stop it first)
  owner-chat NAME  find the owner's chat on F&F's account, allow sends to it, write it to .env
  help             this text
MSG
}

token() { sed -n 's/^INSTINCT_CHAT_TOKEN=//p' "$REPO/.env" 2>/dev/null | head -1; }
load() { launchctl bootstrap "$DOMAIN" "$PLISTS/$1.plist" 2>/dev/null && echo "started $1" || echo "$1 already loaded (or failed; see status)"; }
daemon_ready() { "$WABIN" status 2>/dev/null | grep -q '"ready": *true'; }
wait_daemon() {
  local i
  for i in $(seq 1 45); do daemon_ready && return 0; sleep 2; done
  return 1
}
unload() { launchctl bootout "$DOMAIN/$1" 2>/dev/null && echo "stopped $1" || echo "$1 was not running"; }

case "${1:-help}" in
  start) load "$WA"; sleep 2; load "$AGENT" ;;
  daemon-start)
    daemon_ready || load "$WA"
    echo "waiting for the daemon to be ready (up to 90 s)..."
    wait_daemon && echo "daemon ready" || { echo "daemon not ready; run: fnfctl.sh daemon-login" >&2; exit 1; }
    ;;
  stop) unload "$AGENT"; unload "$WA" ;;
  restart) "$0" stop; sleep 1; "$0" start ;;
  status)
    for l in "$WA" "$AGENT"; do
      printf '%s: ' "$l"; launchctl print "$DOMAIN/$l" 2>/dev/null | grep -E 'state =|pid =' | tr -s ' \n' ' ' || printf 'not loaded'; echo
    done
    printf 'daemon: '; "$WABIN" status 2>&1 | tr -s ' \n' ' '; echo
    printf 'agent: '; curl -s -m 5 -H "Authorization: Bearer $(token)" "http://127.0.0.1:${PORT:-8080}/status" || echo "(no answer)"; echo
    ;;
  logs) tail -n 50 -f "$DATA/logs/agent.out.log" ;;
  daemon-logs) tail -n 50 -f "$DAEMON/bot.log" ;;
  daemon-login)
    unload "$WA" >/dev/null
    echo "Scan the QR from F&F's WhatsApp account: Settings > Linked Devices > Link a device. Wait for 'ready', then Ctrl-C."
    (cd "$DAEMON" && exec node index.js)
    ;;
  owner-chat)
    name="${2:-}"; [ -n "$name" ] || { echo "usage: fnfctl.sh owner-chat NAME" >&2; exit 2; }
    if ! daemon_ready; then "$0" daemon-start || exit 1; fi
    chats="$("$WABIN" chats)" || { echo "daemon not ready; run: fnfctl.sh daemon-start" >&2; exit 1; }
    id="$(printf '%s' "$chats" | python3 -c '
import json, sys
name = sys.argv[1].strip().lower()
chats = [c for c in json.load(sys.stdin) if not c["id"].endswith("@g.us")]
hits = [c for c in chats if c["name"].strip().lower() == name] or [c for c in chats if name in c["name"].strip().lower()]
if len(hits) != 1:
    print("no unique match for %r: %s" % (name, ", ".join("%s (%s)" % (c["name"], c["id"]) for c in hits[:8]) or "none"), file=sys.stderr); sys.exit(1)
print(hits[0]["id"])' "$name")" || exit 1
    echo "owner chat: $id"
    "$WABIN" allow add "$id" || { echo "allow-list not approved; nothing written to .env" >&2; exit 1; }
    tmp="$(mktemp)"
    if grep -q '^FNF_WHATSAPP_OWNER_CHAT=' "$REPO/.env"; then
      sed -e "s|^FNF_WHATSAPP_OWNER_CHAT=.*$|FNF_WHATSAPP_OWNER_CHAT=$id|" "$REPO/.env" > "$tmp"
    else
      { cat "$REPO/.env"; echo "FNF_WHATSAPP_OWNER_CHAT=$id"; } > "$tmp"
    fi
    mv "$tmp" "$REPO/.env" && chmod 600 "$REPO/.env"
    grep -q "^FNF_WHATSAPP_OWNER_CHAT=$id$" "$REPO/.env" || { echo "failed to write .env" >&2; exit 1; }
    echo "wrote FNF_WHATSAPP_OWNER_CHAT=$id to .env; now: fnfctl.sh start (or restart)"
    ;;
  help|-h|--help) usage ;;
  *) usage; exit 2 ;;
esac
