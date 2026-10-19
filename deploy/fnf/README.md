# Running F&F on this Mac

F&F is two launchd services: the WhatsApp daemon (`daemon/`, a clone of
whatsapp-connector logged into F&F's own number) and the agent
(`packages/server/dist/main.js`). Both live in this folder; state is in
`.instinct/`, secrets in `.env`. Neither file is committed.

## Go-live, in order

1. Build: `corepack pnpm@10.6.1 install && corepack pnpm@10.6.1 -r build`
2. `bash deploy/fnf/setup.sh` writes `.env`, seeds the persona, renders the launchd plists.
3. Fill in `.env`: `ANTHROPIC_API_KEY`, `INSTINCT_OWNER_PHONE` (your personal number, +972...), optionally `OPENAI_API_KEY` for voice notes and `COMPOSIO_API_KEY` for Gmail and Calendar.
4. `bash deploy/fnf/fnfctl.sh daemon-login`, then on the phone that holds F&F's WhatsApp account: Settings, Linked Devices, Link a device, scan the QR in the terminal. Wait for `ready`, press Ctrl-C.
5. `bash deploy/fnf/fnfctl.sh daemon-start` loads the daemon as a service and waits until it reports ready.
6. From your own phone, text F&F's number once ("hi").
7. `bash deploy/fnf/fnfctl.sh owner-chat "Reef"` (your name as WhatsApp shows it). A native dialog asks to allow sends to that one chat: Approve. The chat id is written to `.env`.
8. `bash deploy/fnf/fnfctl.sh start`, then `bash deploy/fnf/fnfctl.sh status`. Both services show `state = running`, the daemon shows `"ready": true`, and the agent's `/status` shows `whatsapp.ownerChat`.
9. Text F&F again. The first conversation runs the `fnf-onboarding` skill.

Values in `.env` that contain `$`, backticks or `&` must be double-quoted: the service sources the file with `/bin/sh`.

## Day to day

- `fnfctl.sh logs` follows the agent; `fnfctl.sh daemon-logs` the daemon.
- `.instinct/audit.jsonl` is the record of every inbound, outbound, tool call and policy decision.
- `.instinct/MEMORY.md` and `.instinct/memory/journal/` are what F&F remembers; edit by hand or tell it.
- `.instinct/whatsapp-outbox.json` holds texts that are waiting for the daemon; `.instinct/whatsapp-cursor.json` is where the poller is.
- After `git pull` or a code change: `corepack pnpm@10.6.1 -r build && bash deploy/fnf/fnfctl.sh restart`.
- If the daemon needs a new QR (session expired): `fnfctl.sh daemon-login` again, then `fnfctl.sh start`.

## Tests

`bash deploy/fnf/test.sh` checks the setup script against a throwaway copy.
