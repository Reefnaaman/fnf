# F&F: an Instinct-style personal assistant on WhatsApp

Date: 2026-10-19. Status: draft for owner approval.

## Intent

F&F is Reef's personal agent, modeled on Instinct (Spear Street Technology): a
persistent assistant you text, that remembers you, acts on your behalf, texts
you first when something needs attention, and runs on its own machine so it
keeps working between messages. Instinct lives on iMessage; F&F lives on
WhatsApp, which is the channel Reef and the people around him actually use.

F&F is the open-instinct fork (`Reefnaaman/fnf`, upstream
`mariagorskikh/open-instinct`) plus one new transport: a WhatsApp channel
backed by the local whatsapp-connector daemon (whatsapp-web.js). Everything
else, the agent loop, policy guard, memory, scheduler, skills, approvals and
audit, is inherited from the fork and kept as close to upstream as possible so
upstream fixes merge cleanly.

## Goals

1. Reef texts F&F's own WhatsApp number from his personal WhatsApp and gets a
   reply in that thread, in the language he wrote in (Hebrew or English).
2. F&F keeps memory across days (preferences, people, open loops) and sends a
   proactive morning brief and scheduled follow-ups on WhatsApp without being
   asked.
3. Skills are SKILL.md playbooks in the open-instinct format. The shipped set
   stays; two are added (an F&F onboarding that learns Reef's life context,
   and a WhatsApp etiquette skill), and the two Maritime computer skills are
   removed from the index because there is no cloud desktop in v1.
4. Owner only. The poller watches the owner's chat and nothing else; a text
   from anyone else to F&F's number is never read by the model and never
   answered (an audit line records it). Trust tiers stay in the code for a
   later phase with family and friends.
5. Runs on Reef's Mac under launchd, next to the daemon, and survives reboots.
6. Nothing changes in the daemon's safety model: sends are allow-listed, the
   allow-list is widened only by the native dialog, and the two-step send is
   performed by the channel adapter after the policy guard has already approved
   the action.

## Non-goals (v1)

- No browser or computer use. Bookings that need a website are out until a
  desktop backend is added (local Mac computer use is the obvious v2).
- No payments (Stripe Link needs a US/CA consumer and an OAuth client review).
- No Inkbox, no iMessage, no email channel, no A2A. Those packages stay
  installed but unconfigured.
- No multi-user gateway.
- No changes to Reef's main WhatsApp daemon in `~/PrivateLife`. F&F gets its
  own copy of the connector, logged into F&F's number.

## Anti-goals

- F&F must never send a WhatsApp message to anyone other than the owner in v1.
  The allow-list on F&F's daemon holds exactly one chat: Reef's.
- F&F must never reply twice to one message, reply to its own messages, or
  replay old messages after a daemon restart (the daemon re-syncs history on
  boot and a naive poller would see "new" messages).
- The owner's phone number must never be used as proof of identity on a
  channel that cannot bind it. WhatsApp 1:1 chats on F&F's own account bind
  the sender to a number the same way SMS does, so WhatsApp joins the
  owner-verified channel set. Group chats do not.

## Constraints

- Mac mini/laptop, macOS, Node 22.22, pnpm 10 via corepack, Python 3.11.
- Anthropic key already in `~/.env`. Model: `anthropic/claude-fable-5-1`.
- Composio key not yet available; Gmail and Calendar are wired the moment
  `COMPOSIO_API_KEY` is set, with no code change.
- Timezone Asia/Jerusalem. Owner phone: Reef's personal WhatsApp number (to be
  filled into config by the owner at setup; never committed).
- The daemon exposes only a unix-socket RPC (`status`, `chats`, `read`,
  `send`, `sendConfirm`, `react`, `allowList`, ...). There is no inbound push.

## Decisions (made with the owner)

- WhatsApp first, owner only, fork open-instinct, folder `~/F&F`.
- F&F has its own phone number and WhatsApp account, linked to its own daemon
  copy at `~/F&F/daemon`. Reef's main daemon stays untouched.
- The F&F daemon copy is a plain clone of the connector, gitignored in the
  fnf repo, with origin pointing at `OmerLapidot/whatsapp-connector`.

## Design

### Channel: `whatsapp`

A new package `@open-instinct/whatsapp` with two halves.

**Outbox (`WhatsAppChannel implements Outbox`).** Maps an `OutboundMessage`
to the daemon: `send` returns a token, `sendConfirm` transmits. Conversation
keys are `whatsapp:<chatId>` where chatId is the daemon's chat id
(`<digits>@c.us` or `@lid`). `to: <E.164>` resolves to a chat id through the
daemon's `contacts` RPC. Long texts are split on paragraph and sentence
boundaries the same way the Inkbox channel does for iMessage. `typing()` is a
no-op (the daemon has no typing API). Media sends go through `sendMedia` when
the workspace file exists. Every send and its daemon result lands in the
audit log via the runtime's existing `safeSend`.

**Inbound poller (`WhatsAppInbox`).** A loop in the server process that, every
`poll` interval (default 2 s), calls `read` on each watched chat (v1: the
owner's chat only, discovered from the owner phone at boot) and hands each new
message to `runtime.handleInbound` as an `InboundMessage` with
`channel: "whatsapp"`, `from: <E.164 of sender>`, `conversationKey:
whatsapp:<chatId>`, `id: <daemon message id>`, `replyRef: { chatId }`. New
means: `sender !== "me"` and the message id has not been seen. Seen ids are
persisted in `<data>/whatsapp-cursor.json` with a high-water timestamp so a
restart of either process never replays history; on first boot the cursor is
set to "now" and nothing older is processed. Media messages are downloaded
through the daemon's `media` RPC into `<data>/workspace/inbound` and attached.

If the daemon is down or not ready, the poller logs once, backs off (2 s, 4 s,
... up to 30 s) and resumes; the agent keeps running for scheduled jobs and
the owner is told on the next successful send if a job's output was delayed.

**Core changes (small, upstream-friendly).** `"whatsapp"` is added to
`Channel`, to `OWNER_VERIFIED_CHANNELS`, `DELIVERABLE`, `CARRIER_CHANNELS` and
`APPROVAL_CHANNELS`, to the prompt's channel etiquette (plain text, no
markdown, bare URLs on their own line, emoji only if the owner uses them,
WhatsApp renders `*bold*` with single asterisks), and to `sendToOwner` so a
WhatsApp thread is the owner's preferred route and the owner's phone falls
back to WhatsApp before iMessage when the WhatsApp channel is configured.
`parseConversationKey` learns the new prefix. The owner-claim flow is left
unchanged (phone is configured explicitly).

**Boot wiring.** `boot()` builds the WhatsApp channel when
`FNF_WHATSAPP_SOCKET` (path to the daemon's `control.sock`) is set, wraps it in
`ChatAwareOutbox` like Inkbox, and `main.ts` starts the poller after the HTTP
server is listening. Without the variable nothing changes and upstream
behaviour is preserved.

### Daemon copy

`~/F&F/daemon` is a clone of whatsapp-connector with its own `.wwebjs_auth`,
`control.sock`, `allowlist.json` and `schedules.json` (all inside that folder,
all gitignored). It runs under launchd as `com.fnf.whatsapp-daemon`. First
link is a one-time QR scan from F&F's WhatsApp account. The allow-list gets
exactly one entry, Reef's chat, approved once through the native dialog.

### Agent process

`~/F&F` runs `packages/server/dist/main.js` under launchd as
`com.fnf.agent`, with `INSTINCT_DATA_DIR=~/F&F/.instinct`,
`INSTINCT_CHAT_TOKEN` set, loopback bind, `INSTINCT_COMPUTER=none`,
`FNF_WHATSAPP_SOCKET=~/F&F/daemon/control.sock`. Secrets come from
`~/F&F/.env` (gitignored), never from the repo.

### Persona, instructions, memory, skills

- `PERSONA.md`: name F&F, texting voice, replies in the owner's language,
  terse, first 30% of every message carries the point, confirms before
  anything with a cost or a third party.
- `AGENTS.md`: house rules (quiet hours, Hebrew/English, Israeli dates and
  currency, never message anyone but the owner in v1).
- `MEMORY.md` seeded during the F&F onboarding skill: name, city, timezone,
  messaging style, people who matter, standing preferences.
- Schedules: a daily brief at a time the owner picks, in Asia/Jerusalem.
- Skills: shipped set minus `maritime` and `maritime-computer`; plus
  `fnf-onboarding` and `whatsapp-etiquette`.

### Testing

- Unit tests for the channel (outbox mapping, splitting, two-step send,
  contact resolution, error codes) against a fake daemon RPC.
- Unit tests for the poller (dedupe, cursor persistence, restart replay
  guard, media download, backoff).
- Core tests updated for the new channel in the owner-verified and
  deliverable sets.
- A runtime smoke test with a fake daemon and a fake model proving a text
  from the owner's chat produces exactly one reply and that a message in any
  other chat is ignored and audited.
- Manual end-to-end: Reef texts F&F's number and gets a reply; the daily
  brief fires on WhatsApp.

## Calls made after the builder check

These were open questions a reviewer raised. Each is the author's decision; the
owner can override any of them.

1. **Strangers are ignored, not refused.** v1 never sends to a non-owner, so
   the poller reads only the owner's chat. Goal 4 is worded accordingly.
2. **The owner chat is pinned by chat id.** The daemon reports senders as push
   names and 1:1 chat ids may be `@lid` with no phone digits, so the owner
   cannot be discovered from a phone number. Setup stores
   `FNF_WHATSAPP_OWNER_CHAT=<chat id>` (the same id that goes on the
   allow-list). The poller stamps `from = config.owner.phones[0]` on every
   message from that chat. Missing or ambiguous id: fail closed, log, do not
   poll. Bootstrap order is: Reef texts F&F first, the chat then exists, the
   allow-list entry is approved, the id is written to `.env`. No patches to the
   daemon clone in v1.
3. **Delivery is at-most-once.** A send that fails before `sendConfirm` is
   queued in `<data>/whatsapp-outbox.json` and flushed when the daemon is
   ready again, prefixed "(delayed)". A `sendConfirm` that times out is never
   retried, because the message may have gone out. Queue entries older than
   12 hours are dropped with an audit line.
4. **v1 is text only on WhatsApp.** `send_file` stays chat-only and the prompt
   line that promises attachments is adjusted for the WhatsApp channel.
   Inbound media is still downloaded and attached as a path.
5. **Voice notes are transcribed when `OPENAI_API_KEY` is set** (OpenAI
   `audio/transcriptions`, model `gpt-4o-mini-transcribe`, language auto). The
   text reaches the model as "[voice note] ...". Without the key the owner
   gets one short reply asking them to type it. Israeli WhatsApp use is voice
   note heavy, so this is in v1.

## Left to the builder

- Exact file layout inside `packages/whatsapp`, following the Inkbox package.
- Whether the poller lives in the server package or the whatsapp package
  (either is fine; it must not import `@open-instinct/network`).
- The split length for WhatsApp (iMessage uses 1500 chars; WhatsApp allows
  far more, 3000 is a reasonable cap).
- launchd plist details, log paths, restart policy.
