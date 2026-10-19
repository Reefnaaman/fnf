#!/usr/bin/env bash
# Checks for deploy/fnf/setup.sh against a throwaway copy of the repo and a throwaway HOME.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# The real folder is ~/F&F: the "&" must survive every path substitution.
WORK="$(mktemp -d)/F&F"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

# A minimal repo copy: the deploy folder plus an empty node_modules marker.
mkdir -p "$WORK/repo/deploy" "$WORK/repo/daemon" "$WORK/home"
cp -R "$HERE" "$WORK/repo/deploy/fnf"
export HOME="$WORK/home"
export FNF_SETUP_NODE="/usr/local/bin/node"

bash "$WORK/repo/deploy/fnf/setup.sh" > "$WORK/setup1.log" 2>&1 || { cat "$WORK/setup1.log"; fail "setup.sh exited non-zero"; }

[ -f "$WORK/repo/.env" ] || fail ".env not created"
grep -qE '^INSTINCT_CHAT_TOKEN=[0-9a-f]{48}$' "$WORK/repo/.env" || fail "INSTINCT_CHAT_TOKEN is not 48 hex chars"
grep -q '^INSTINCT_OWNER_TIMEZONE=Asia/Jerusalem$' "$WORK/repo/.env" || fail "timezone not Asia/Jerusalem"
grep -qF "FNF_WHATSAPP_SOCKET=\"$WORK/repo/daemon/control.sock\"" "$WORK/repo/.env" || fail "socket path not rendered and quoted (check the & in the path)"
grep -qF "INSTINCT_DATA_DIR=\"$WORK/repo/.instinct\"" "$WORK/repo/.env" || fail "data dir not rendered and quoted (check the & in the path)"
ok ".env created with token, timezone and socket path"

# The agent plist sources .env with /bin/sh; every value must survive that, including the "&" in F&F.
( cd "$WORK/repo" && sh -c 'set -e; set -a; . ./.env; set +a; [ "$INSTINCT_AGENT_NAME" = "F&F" ] && [ -n "$INSTINCT_CHAT_TOKEN" ] && [ "$INSTINCT_DATA_DIR" = "'"$WORK"'/repo/.instinct" ] && [ "$FNF_WHATSAPP_SOCKET" = "'"$WORK"'/repo/daemon/control.sock" ]' 2>/dev/null ) || fail ".env does not source cleanly under /bin/sh (quote values with special characters such as &)"
ok ".env sources cleanly under sh and keeps the agent name F&F"

cmp -s "$WORK/repo/.instinct/PERSONA.md" "$HERE/PERSONA.md" || fail "PERSONA.md not copied"
cmp -s "$WORK/repo/.instinct/AGENTS.md" "$HERE/AGENTS.md" || fail "AGENTS.md not copied"
ok "persona and instructions seeded"

for label in com.fnf.agent com.fnf.whatsapp-daemon; do
  plist="$HOME/Library/LaunchAgents/$label.plist"
  [ -f "$plist" ] || fail "$plist not written"
  plutil -lint "$plist" > /dev/null || fail "$plist is not valid"
  grep -qF "${WORK//&/&amp;}/repo" "$plist" || fail "$plist does not point at the repo with the & XML-escaped"
  grep -q "/usr/local/bin/node" "$plist" || fail "$plist does not use FNF_SETUP_NODE"
done
ok "both launchd plists rendered and valid"

sum1="$(shasum "$WORK/repo/.env" | cut -d' ' -f1)"
echo "# owner edit" >> "$WORK/repo/.instinct/PERSONA.md"
bash "$WORK/repo/deploy/fnf/setup.sh" > "$WORK/setup2.log" 2>&1 || fail "second setup.sh run failed"
sum2="$(shasum "$WORK/repo/.env" | cut -d' ' -f1)"
[ "$sum1" = "$sum2" ] || fail ".env changed on a second run"
grep -q "# owner edit" "$WORK/repo/.instinct/PERSONA.md" || fail "second run overwrote the owner's PERSONA.md"
ok "setup.sh is idempotent"

bash "$WORK/repo/deploy/fnf/fnfctl.sh" help 2>&1 | grep -q "daemon-login" || fail "fnfctl.sh help does not list daemon-login"
ok "fnfctl.sh help lists its commands"


# owner-chat: with a stub `wa`, it must write the chat id into .env even when the line is missing,
# and must not claim success when the allow-list dialog was denied.
STUB="$WORK/stubwa"; mkdir -p "$STUB"
cat > "$STUB/wa" <<'WA'
#!/usr/bin/env bash
case "$1" in
  status) echo '{"state":"ready","ready":true}' ;;
  chats) echo '[{"id":"120363000000000000@g.us","name":"Reef family","unread":0},{"id":"972501234567@c.us","name":"Reef","unread":0}]' ;;
  allow) [ "${WA_DENY:-0}" = "1" ] && { echo "error: allow-list change not approved: denied on screen by the user" >&2; exit 1; } || echo '["972501234567@c.us"]' ;;
  *) exit 2 ;;
esac
WA
chmod +x "$STUB/wa"
sed -i '' '/^FNF_WHATSAPP_OWNER_CHAT=/d' "$WORK/repo/.env"
( cd "$WORK/repo" && FNF_WA_BIN="$STUB/wa" bash deploy/fnf/fnfctl.sh owner-chat Reef > "$WORK/oc.log" 2>&1 ) || { cat "$WORK/oc.log"; fail "owner-chat failed with the stub daemon"; }
grep -q '^FNF_WHATSAPP_OWNER_CHAT=972501234567@c.us$' "$WORK/repo/.env" || fail "owner-chat did not write the 1:1 chat id into .env"
ok "owner-chat picks the 1:1 chat, skips the group, and writes .env"
( cd "$WORK/repo" && WA_DENY=1 FNF_WA_BIN="$STUB/wa" bash deploy/fnf/fnfctl.sh owner-chat Reef > "$WORK/oc2.log" 2>&1 ) && fail "owner-chat claimed success after a denied dialog"
grep -q "nothing written" "$WORK/oc2.log" || fail "owner-chat did not say the denial left .env untouched"
ok "owner-chat treats a denied dialog as final"
grep -q "daemon-start" "$HERE/README.md" || fail "README does not tell the owner to start the daemon before owner-chat"
ok "runbook starts the daemon before owner-chat"
echo "all checks passed"
