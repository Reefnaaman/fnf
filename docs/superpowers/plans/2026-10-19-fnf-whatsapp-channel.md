# F&F WhatsApp Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the open-instinct fork answer the owner on WhatsApp through the local whatsapp-connector daemon, run it on the Mac under launchd, and ship the F&F persona, instructions and skills.

**Architecture:** A new workspace package `@open-instinct/whatsapp` holds an `Outbox` implementation (two-step send over the daemon's unix-socket RPC, with an at-most-once retry queue) and an inbound poller that reads one pinned owner chat and hands new messages to `AgentRuntime.handleInbound`. Core learns a `whatsapp` channel in its channel sets and prompt etiquette. `boot()` wires the channel when `FNF_WHATSAPP_SOCKET` and `FNF_WHATSAPP_OWNER_CHAT` are set; `main.ts` starts the poller. Deploy files give the agent and the daemon copy launchd services.

**Tech Stack:** TypeScript (ES2022, NodeNext), pnpm 10 workspace, vitest 3, Node 22 `http` over unix sockets, Pi agent core, whatsapp-web.js daemon (unchanged clone in `daemon/`).

**Spec:** `docs/superpowers/specs/2026-10-19-fnf-whatsapp-assistant-design.md`

## Global Constraints

- Node `>=22.19.0`; build with `corepack pnpm@10.6.1`; every package uses `tsc -p tsconfig.json` and `vitest run --passWithNoTests`.
- No edits inside `daemon/` (gitignored clone of OmerLapidot/whatsapp-connector).
- Core changes stay minimal and additive so upstream merges cleanly; no new dependencies in core.
- v1 never sends to a chat other than `FNF_WHATSAPP_OWNER_CHAT`; the channel refuses any other target with an error, independent of the daemon's allow-list.
- Delivery is at-most-once: a `sendConfirm` that errors or times out is never retried.
- Secrets live in `~/F&F/.env` (gitignored) and never in the repo or the data dir.
- Timezone `Asia/Jerusalem`; model `anthropic/claude-fable-5-1`; `INSTINCT_COMPUTER=none`.
- Commit messages: `<type>: <description>` (feat, fix, refactor, docs, test, chore), ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. The daemon restarts and re-syncs history: every message in the owner chat reappears with old ids. Expected: nothing is re-processed (Task 4, cursor test).
2. The owner sends a 4,000-character paste. Expected: it arrives as one inbound message; the reply splits into bubbles of at most 3,000 chars on paragraph or sentence boundaries, in order (Task 3, split test).
3. The daemon answers `send` but the socket dies before `sendConfirm` returns. Expected: no retry, one audit error, the owner is not double-texted (Task 3, confirm-failure test).
4. A WhatsApp text contains only an emoji or is empty with media (a photo with no caption). Expected: the model gets "[photo]" plus the attachment path, never an empty prompt (Task 4, media test).
5. `FNF_WHATSAPP_OWNER_CHAT` is unset while `FNF_WHATSAPP_SOCKET` is set. Expected: boot logs one clear line, the poller does not start, the agent still runs (Task 5, boot test).

---

### Task 1: Core learns the `whatsapp` channel

**Files:**
- Modify: `packages/core/src/types.ts:143` (Channel union)
- Modify: `packages/core/src/principal.ts:75` (OWNER_VERIFIED_CHANNELS)
- Modify: `packages/core/src/runtime.ts:109-116,276,425,957-987`
- Modify: `packages/core/src/prompt.ts:211-240,258,304`
- Modify: `packages/core/src/core-tools.ts:180-190`
- Test: `packages/core/test/principal.test.ts`, `packages/core/test/runtime.test.ts`, `packages/core/test/prompt.test.ts`

**Interfaces:**
- Produces: `Channel` now includes `"whatsapp"`. `RuntimeDeps.ownerPhoneChannel?: "imessage" | "whatsapp"` (default `"imessage"`): the channel used when the owner is reached by phone with no prior thread. `CoreToolDeps.ownerPhoneChannel` with the same meaning, used by `ask_owner`/`notify_owner` relays.

- [ ] **Step 1: Write the failing tests**

```ts
// principal.test.ts
it("whatsapp from the owner's phone is the owner", () => {
  const p = resolvePrincipal(inbound({ channel: "whatsapp", from: "+972501234567" }), configWithPhone("+972501234567"), c);
  expect(p).toMatchObject({ kind: "owner", tier: "owner" });
});
// runtime.test.ts
it("sendToOwner prefers the last whatsapp thread and falls back to the configured owner channel", async () => {
  // runtime built with ownerPhoneChannel: "whatsapp", no prior thread
  await runtime.relayToOwner("hi", "system");
  expect(outbox.sent[0].msg).toMatchObject({ channel: "whatsapp", to: "+972501234567" });
});
it("a whatsapp reply is deliverable and an owner yes on whatsapp settles an approval", ...); // mirror the existing sms cases
// prompt.test.ts
it("whatsapp channel section bans markdown and mentions single-asterisk bold", () => {
  expect(buildSystemPrompt({ ...input, channel: "whatsapp" })).toMatch(/single \*asterisks\*/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && corepack pnpm@10.6.1 vitest run test/principal.test.ts test/runtime.test.ts test/prompt.test.ts`
Expected: FAIL with type errors on `"whatsapp"` and the relay assertion.

- [ ] **Step 3: Add the channel to core**

- `types.ts`: `Channel = ... | "whatsapp"`.
- `principal.ts`: add `"whatsapp"` to `OWNER_VERIFIED_CHANNELS`.
- `runtime.ts`: add `"whatsapp"` to `DELIVERABLE`, `APPROVAL_CHANNELS`, `CHANNELS`, `CARRIER_CHANNELS`; the saved-route check at line 276 and the claim guard at line 425 use `CARRIER_CHANNELS.has(...)`; `sendToOwner` uses `last && CARRIER_CHANNELS.has(last.channel)` for the thread case and `channel: this.deps.ownerPhoneChannel ?? "imessage"` for the phone case; add `ownerPhoneChannel?: "imessage" | "whatsapp"` to `RuntimeDeps`.
- `prompt.ts`: `channelSection` case `"whatsapp"`: "This is a WhatsApp thread with your owner. Short replies, like a capable friend texting. No markdown headings, no bullet markers, no code fences. Bold is single *asterisks* only, and only for one key word. Reply in the language the owner wrote in. Put a URL bare on its own line. One question at a time."; include `"whatsapp"` in the `longTaskSection` carrier check; the send_file line at 258 becomes channel-aware: on `"whatsapp"` it reads "- Files cannot be sent on WhatsApp yet. Describe the result in text; offer to email it later."
- `core-tools.ts`: `ownerTools` sends `{ channel: deps.ownerPhoneChannel ?? "imessage", to: phone, text }` and audits the same channel.

- [ ] **Step 4: Run the core tests**

Run: `cd packages/core && corepack pnpm@10.6.1 test`
Expected: PASS, all files.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): add whatsapp as an owner-verified carrier channel"
```

---

### Task 2: Package scaffold and the daemon RPC client

**Files:**
- Create: `packages/whatsapp/package.json`, `packages/whatsapp/tsconfig.json`, `packages/whatsapp/README.md`
- Create: `packages/whatsapp/src/index.ts`, `packages/whatsapp/src/rpc.ts`
- Create: `packages/whatsapp/test/fake-daemon.ts`, `packages/whatsapp/test/rpc.test.ts`

**Interfaces:**
- Produces:
  - `class DaemonRpc { constructor(opts: { socketPath: string; timeoutMs?: number }); call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> }` posting `{cmd,args}` to `/rpc` over the unix socket; a `{ok:false}` body throws `DaemonError` with `.code` (e.g. `NOT_ALLOWED`, `NOT_READY`, `NO_PENDING`); socket errors throw `DaemonError` with code `DAEMON_DOWN`.
  - `class DaemonError extends Error { code: string }`
  - `test/fake-daemon.ts`: `startFakeDaemon(opts?: { ready?: boolean }): Promise<{ socketPath: string; chats: FakeChat[]; sent: Array<{chatId: string; text: string}>; confirms: number; failConfirm: boolean; messagesFor(chatId): FakeMessage[]; push(chatId, msg): void; close(): Promise<void> }>` implementing `status`, `chats`, `read`, `send` (returns a token), `sendConfirm`, `media`, `allowList` with the same JSON shapes as `daemon/src/control-server.js`.
- Package name `@open-instinct/whatsapp`, dependencies `@open-instinct/core: workspace:*`, dev deps as in `packages/inkbox/package.json`.

- [ ] **Step 1: Write the failing test**

```ts
it("call returns data and maps daemon errors to DaemonError codes", async () => {
  const d = await startFakeDaemon();
  const rpc = new DaemonRpc({ socketPath: d.socketPath });
  await expect(rpc.call("status")).resolves.toMatchObject({ ready: true });
  await expect(rpc.call("send", { chat: "nope", text: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await d.close();
  await expect(rpc.call("status")).rejects.toMatchObject({ code: "DAEMON_DOWN" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/whatsapp && corepack pnpm@10.6.1 vitest run test/rpc.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create the package and implement `DaemonRpc` and the fake daemon**

Copy `packages/inkbox/package.json` and `tsconfig.json`, drop the Inkbox dependency. Add `packages/whatsapp` to the server's dependencies later (Task 5). `rpc.ts` uses `node:http` `request({ socketPath, path: "/rpc", method: "POST" })` like `daemon/src/rpc-client.js`, with a timeout (default 15 s) that rejects with `DAEMON_DOWN`.

- [ ] **Step 4: Run the test and the workspace install**

Run: `corepack pnpm@10.6.1 install && cd packages/whatsapp && corepack pnpm@10.6.1 test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/whatsapp pnpm-lock.yaml
git commit -m "feat(whatsapp): package scaffold with daemon RPC client"
```

---

### Task 3: Outbox with two-step send, splitting and the retry queue

**Files:**
- Create: `packages/whatsapp/src/channel.ts`, `packages/whatsapp/src/queue.ts`, `packages/whatsapp/src/split.ts`
- Test: `packages/whatsapp/test/channel.test.ts`, `packages/whatsapp/test/queue.test.ts`

**Interfaces:**
- Consumes: `DaemonRpc`, `DaemonError` (Task 2); `Outbox`, `OutboundMessage`, `Principal` from core.
- Produces:
  - `WHATSAPP_MAX_CHARS = 3000`; `splitMessageText(text: string, max = WHATSAPP_MAX_CHARS): string[]` (same boundary rules as `packages/inkbox/src/channel.ts:splitMessageText`).
  - `class WhatsAppChannel implements Outbox { constructor(opts: { rpc: DaemonRpc; ownerChatId: string; ownerPhone: string; queue: OutboxQueue; logger?: (m: string) => void; now?: () => Date }); send(msg, ctx): Promise<void>; typing(key): Promise<void>; flushQueue(): Promise<number> }`.
    - Target resolution: `msg.conversationKey === "whatsapp:<ownerChatId>"` or `msg.to` normalized equal to `ownerPhone` → `ownerChatId`; anything else throws `DaemonError("NOT_OWNER")` before touching the daemon.
    - Each part: `send` → token → `sendConfirm`. If `send` throws (daemon down or not ready), the remaining parts are queued and the method returns normally with a log line. If `sendConfirm` throws, the error propagates and nothing is queued.
  - `class OutboxQueue { constructor(file: string, opts?: { maxAgeMs?: number; now?: () => Date }); push(entry: { chatId: string; text: string; at: string }): void; drain(): QueueEntry[]; size(): number }` persisted as JSON; entries older than `maxAgeMs` (default 12 h) are dropped on `drain()` and returned separately as `expired`.
  - Flushed texts are prefixed `"(delayed) "`.

- [ ] **Step 1: Write the failing tests**

```ts
it("sends the owner's reply in order through send + sendConfirm", ...); // expect d.sent.map(s=>s.text) equal to the split parts and d.confirms === parts.length
it("refuses any chat but the owner's", async () => {
  await expect(ch.send({ channel: "whatsapp", to: "+15550000000", text: "x" }, ctx)).rejects.toMatchObject({ code: "NOT_OWNER" });
  expect(d.sent).toHaveLength(0);
});
it("splits a 4000-char reply into bubbles of at most 3000 chars on a paragraph break", ...);
it("queues when send fails before confirm and flushes with a (delayed) prefix", ...); // close daemon, send, reopen, flushQueue() === 1
it("does not retry when sendConfirm fails", ...); // d.failConfirm = true; expect rejects; queue.size() === 0
it("drain drops entries older than 12 hours", ...); // queue.test.ts with a fake now
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/whatsapp && corepack pnpm@10.6.1 vitest run test/channel.test.ts test/queue.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `split.ts`, `queue.ts`, `channel.ts` as specified**

- [ ] **Step 4: Run the package tests**

Run: `cd packages/whatsapp && corepack pnpm@10.6.1 test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/whatsapp
git commit -m "feat(whatsapp): outbox with two-step send, splitting and at-most-once queue"
```

---

### Task 4: Inbound poller with cursor, media and voice notes

**Files:**
- Create: `packages/whatsapp/src/inbox.ts`, `packages/whatsapp/src/cursor.ts`, `packages/whatsapp/src/transcribe.ts`
- Test: `packages/whatsapp/test/inbox.test.ts`, `packages/whatsapp/test/transcribe.test.ts`

**Interfaces:**
- Consumes: `DaemonRpc` (Task 2); `InboundMessage` from core.
- Produces:
  - `class Cursor { constructor(file: string); seen(id: string): boolean; mark(id: string, ts: number): void; highWater(): number; initIfEmpty(nowSeconds: number): void }` persisted as `{ highWater: number, seen: string[] }` keeping the last 500 ids.
  - `transcribeAudio(opts: { path: string; mimetype: string; apiKey: string; fetchImpl?: typeof fetch; model?: string }): Promise<string>` posting multipart to `https://api.openai.com/v1/audio/transcriptions` with `model` default `gpt-4o-mini-transcribe`; returns the `text` field; throws on non-200.
  - `class WhatsAppInbox { constructor(opts: { rpc: DaemonRpc; ownerChatId: string; ownerPhone: string; cursorFile: string; inboundDir: string; onMessage: (m: InboundMessage) => Promise<unknown>; logger?: (m: string) => void; pollMs?: number; readLimit?: number; transcribe?: (path: string, mimetype: string) => Promise<string>; now?: () => Date }); start(): void; stop(): void; pollOnce(): Promise<number> }`.
    - `pollOnce` calls `read` with `{ chat: ownerChatId, limit: readLimit ?? 50 }`, keeps messages with `sender !== "me"`, `ts > highWater - 60` and not `seen`, oldest first, and for each builds `InboundMessage { id: m.id, channel: "whatsapp", conversationKey: "whatsapp:"+ownerChatId, from: ownerPhone, text, receivedAt, replyRef: { chatId: ownerChatId, messageId: m.id }, attachments? }`, awaits `onMessage`, then `mark`s it. Returns the count handled.
    - Media: when `hasMedia`, call `media` RPC, copy the file into `inboundDir` under `<messageId-safe>.<ext>`, and set `attachments: [{ path, mimeType }]`. Text becomes: caption if any; else `"[photo]"`, `"[video]"`, `"[document: <name>]"` by mimetype; for `audio/*` with a transcriber: `"[voice note] " + transcript`, without one: `"[voice note, not transcribed]"`.
    - Backoff: on `DAEMON_DOWN` or `NOT_READY`, log once per outage, double the interval from `pollMs` (default 2000) up to 30 000 ms; reset on success.
    - First run with an empty cursor: `initIfEmpty(now)` so history is never processed.

- [ ] **Step 1: Write the failing tests**

```ts
it("processes only new owner messages, oldest first, and never its own", ...);
it("does not replay history after a restart with the same cursor file", ...); // new WhatsAppInbox over the same file; pollOnce() === 0
it("ignores anything before the cursor on first boot", ...);
it("a photo without caption becomes [photo] with an attachment path inside inboundDir", ...);
it("a voice note is transcribed when a transcriber is given", ...); // text starts with "[voice note] "
it("backs off while the daemon is down and recovers", ...); // fake timers
it("transcribeAudio posts multipart with the model and returns text", ...); // fake fetch inspects FormData
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/whatsapp && corepack pnpm@10.6.1 vitest run test/inbox.test.ts test/transcribe.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `cursor.ts`, `transcribe.ts`, `inbox.ts`; export everything from `index.ts` together with `whatsappSettings(env): { socketPath: string; ownerChatId?: string } | undefined` (reads `FNF_WHATSAPP_SOCKET`, `FNF_WHATSAPP_OWNER_CHAT`)**

- [ ] **Step 4: Run the package tests and typecheck**

Run: `cd packages/whatsapp && corepack pnpm@10.6.1 test && corepack pnpm@10.6.1 typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/whatsapp
git commit -m "feat(whatsapp): inbound poller with restart-safe cursor, media and voice notes"
```

---

### Task 5: Boot and main wiring, smoke test

**Files:**
- Modify: `packages/server/package.json` (add `"@open-instinct/whatsapp": "workspace:*"`)
- Modify: `packages/server/src/boot.ts:60-80,120-150,330-345,370-395`
- Modify: `packages/server/src/main.ts:24-40,52-62`
- Modify: `packages/server/src/http.ts:297` (status gains `whatsapp: { ownerChat, queued }` when configured)
- Modify: `deploy/.env.example` (new section)
- Test: `packages/server/test/whatsapp-boot.test.ts`

**Interfaces:**
- Consumes: `WhatsAppChannel`, `WhatsAppInbox`, `OutboxQueue`, `DaemonRpc`, `whatsappSettings`, `transcribeAudio` (Tasks 2-4); `RuntimeDeps.ownerPhoneChannel`, `CoreToolDeps.ownerPhoneChannel` (Task 1).
- Produces: `BootResult.whatsapp?: { channel: WhatsAppChannel; inbox: WhatsAppInbox; ownerChatId: string }`. Boot order in `boot()`: when `whatsappSettings(env)` returns a socket and an owner chat id and `config.owner.phones[0]` exists → `channel = new WhatsAppChannel(...)` with `queue` at `state.path("whatsapp-outbox.json")`, outbox = `new ChatAwareOutbox(channel)`, `ownerPhoneChannel: "whatsapp"` passed to both `coreTools` and `AgentRuntime`, `inbox = new WhatsAppInbox({..., cursorFile: state.path("whatsapp-cursor.json"), inboundDir: state.path("workspace","inbound"), onMessage: (m) => runtime.handleInbound(m), transcribe: env.OPENAI_API_KEY ? (p, mt) => transcribeAudio({ path: p, mimetype: mt, apiKey: env.OPENAI_API_KEY }) : undefined })`. Socket set but owner chat or owner phone missing → `log("whatsapp: FNF_WHATSAPP_SOCKET is set but FNF_WHATSAPP_OWNER_CHAT/owner phone is missing; WhatsApp disabled")` and console outbox as today. `main.ts`: after `listen`, `app.whatsapp?.inbox.start()` and `void app.whatsapp?.channel.flushQueue()`; shutdown calls `inbox.stop()`.

- [ ] **Step 1: Write the failing smoke test**

```ts
it("a text in the owner chat produces exactly one WhatsApp reply", async () => {
  const d = await startFakeDaemon(); d.chats.push({ id: OWNER_CHAT, name: "Reef" });
  const app = await bootWith({ FNF_WHATSAPP_SOCKET: d.socketPath, FNF_WHATSAPP_OWNER_CHAT: OWNER_CHAT, INSTINCT_OWNER_PHONE: "+972501234567" }, faux model replying "Hi Reef");
  d.push(OWNER_CHAT, { id: "m1", sender: "Reef", ts: nowSeconds(), text: "hello", hasMedia: false });
  expect(await app.whatsapp!.inbox.pollOnce()).toBe(1);
  expect(d.sent).toEqual([{ chatId: OWNER_CHAT, text: "Hi Reef" }]);
});
it("a message in another chat is never read", ...); // push to OTHER_CHAT; pollOnce() === 0; d.sent empty
it("socket without owner chat boots with WhatsApp disabled", ...); // app.whatsapp undefined; log contains "WhatsApp disabled"
```

Use the `bootWith` pattern from `packages/server/test/atomicmail.test.ts:62-90` (faux provider, `INSTINCT_MODEL: "faux/faux-1"`).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && corepack pnpm@10.6.1 vitest run test/whatsapp-boot.test.ts`
Expected: FAIL, `app.whatsapp` undefined.

- [ ] **Step 3: Wire boot, main, status and the env example**

`.env.example` section:
```
# ----- F&F: WhatsApp through the local whatsapp-connector daemon ------------------------
# Path to the daemon's control socket (daemon/control.sock). Set with FNF_WHATSAPP_OWNER_CHAT to turn WhatsApp on.
# FNF_WHATSAPP_SOCKET=/Users/you/F&F/daemon/control.sock
# The owner's chat id as `wa chats` prints it (…@c.us or …@lid). The only chat F&F ever reads or writes.
# FNF_WHATSAPP_OWNER_CHAT=
# Optional: voice notes are transcribed with OpenAI when set.
# OPENAI_API_KEY=
```

- [ ] **Step 4: Run the whole workspace**

Run: `corepack pnpm@10.6.1 -r build && corepack pnpm@10.6.1 test`
Expected: all packages PASS, including the three new smoke tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server deploy/.env.example pnpm-lock.yaml
git commit -m "feat(server): wire the WhatsApp channel and poller into boot"
```

---

### Task 6: F&F persona, instructions and skills

**Files:**
- Create: `deploy/fnf/PERSONA.md`, `deploy/fnf/AGENTS.md`
- Create: `skills/fnf-onboarding/SKILL.md`, `skills/whatsapp-etiquette/SKILL.md`
- Delete: `skills/maritime/`, `skills/maritime-computer/`
- Modify: `skills/README.md` (layout list)
- Test: `packages/server/test/skills.test.ts` (loader check lists the two new skills and no maritime skill)

**Interfaces:**
- Produces: the two data-dir seed files the setup script (Task 7) copies to `<data>/PERSONA.md` and `<data>/AGENTS.md`.

- [ ] **Step 1: Write the failing test**

```ts
it("the shipped skill set includes fnf-onboarding and whatsapp-etiquette and no maritime skill", () => {
  const names = createSkillCatalog({ builtinDirs: REPO_SKILLS, ownerDir: tmp, log }).list().map((s) => s.name);
  expect(names).toEqual(expect.arrayContaining(["fnf-onboarding", "whatsapp-etiquette"]));
  expect(names.some((n) => n.startsWith("maritime"))).toBe(false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && corepack pnpm@10.6.1 vitest run test/skills.test.ts`
Expected: FAIL on the maritime assertion.

- [ ] **Step 3: Write the files**

- `PERSONA.md` (about 30 lines): name F&F; a capable friend who texts; answers in the owner's language (Hebrew or English), Hebrew without nikud, dates day-month, prices in ₪ unless the owner uses another currency; the first sentence carries the point; no emojis unless the owner uses them; confirms before anything that costs money, commits the owner, or involves a third party; never claims to have done something it did not do.
- `AGENTS.md`: quiet hours 23:00-07:30 Asia/Jerusalem unless urgent; in v1 message nobody but the owner; when asked for something that needs a browser or a payment, say plainly it cannot yet and offer the closest thing it can do (research, a draft, a reminder).
- `skills/fnf-onboarding/SKILL.md`: follows `skills/onboarding/SKILL.md` but WhatsApp-only, one question per message, saves with `memory_write` as it goes, skips app links when apps are not configured (tool `apps_connect` absent), ends by offering the daily brief with `schedule_create` in `Asia/Jerusalem`. Under 120 lines, with a "Do not" list.
- `skills/whatsapp-etiquette/SKILL.md`: how WhatsApp renders text (single `*bold*`, `_italic_`, no headings), voice-note handling ("[voice note]" prefix means the owner spoke; reply in the same language), replying to a "[photo]" with a question about what the owner wants done with it, keeping bubbles under 3000 chars.

- [ ] **Step 4: Run the server tests and the loader check**

Run: `cd packages/server && corepack pnpm@10.6.1 test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add deploy/fnf skills
git commit -m "feat: F&F persona, standing instructions and WhatsApp skills"
```

---

### Task 7: Setup script, launchd services and runbook

**Files:**
- Create: `deploy/fnf/setup.sh`, `deploy/fnf/com.fnf.agent.plist.template`, `deploy/fnf/com.fnf.whatsapp-daemon.plist.template`, `deploy/fnf/fnfctl.sh`, `deploy/fnf/README.md`, `deploy/fnf/env.example`
- Test: `deploy/fnf/test.sh` (bash; runs in CI-less mode)

**Interfaces:**
- Consumes: `deploy/fnf/PERSONA.md`, `deploy/fnf/AGENTS.md` (Task 6).
- Produces:
  - `setup.sh`: idempotent; creates `.instinct/`, copies the persona and instructions only if absent, creates `.env` from `env.example` if absent, generates `INSTINCT_CHAT_TOKEN` with `openssl rand -hex 24` when empty, renders both plist templates into `~/Library/LaunchAgents/` with absolute paths (`node` from `command -v node`, repo root, daemon dir), and prints the next manual steps.
  - `fnfctl.sh {start|stop|restart|status|logs|daemon-login|owner-chat <name>}`: `daemon-login` runs `node daemon/index.js` in the foreground for the QR; `owner-chat` runs `daemon/bin/wa chats`, picks the chat whose name matches, runs `wa allow add` (native dialog) and writes `FNF_WHATSAPP_OWNER_CHAT` into `.env`.
  - `env.example` values: `INSTINCT_DATA_DIR=<repo>/.instinct`, `INSTINCT_OWNER_NAME=Reef`, `INSTINCT_OWNER_PHONE=`, `INSTINCT_OWNER_TIMEZONE=Asia/Jerusalem`, `INSTINCT_AGENT_NAME=F&F`, `INSTINCT_MODEL=anthropic/claude-fable-5-1`, `INSTINCT_COMPUTER=none`, `INSTINCT_ACK_SLOW_REPLIES=1`, `INSTINCT_CHAT_TOKEN=`, `FNF_WHATSAPP_SOCKET=<repo>/daemon/control.sock`, `FNF_WHATSAPP_OWNER_CHAT=`, `ANTHROPIC_API_KEY=`, `OPENAI_API_KEY=`, `COMPOSIO_API_KEY=`.
  - Agent plist: `ProgramArguments` = node `packages/server/dist/main.js`, `WorkingDirectory` = repo, `EnvironmentVariables` loaded by a wrapper line `/bin/sh -c 'set -a; . ./.env; exec node packages/server/dist/main.js'`, `KeepAlive` true, `RunAtLoad` true, logs to `.instinct/logs/agent.{out,err}.log`.
  - Daemon plist: label `com.fnf.whatsapp-daemon`, same shape as `daemon/bot.sh` writes but with the F&F label and working directory `daemon/`.

- [ ] **Step 1: Write the failing test**

`deploy/fnf/test.sh`: runs `setup.sh` against a temp `HOME` and repo copy, then asserts: `.env` exists with a 48-hex `INSTINCT_CHAT_TOKEN`; `.instinct/PERSONA.md` equals `deploy/fnf/PERSONA.md`; both rendered plists pass `plutil -lint`; running `setup.sh` twice leaves `.env` unchanged (compare checksums).

- [ ] **Step 2: Run it to verify it fails**

Run: `bash deploy/fnf/test.sh`
Expected: FAIL, `setup.sh` not found.

- [ ] **Step 3: Write the scripts, templates, env example and README** (README: the six-step go-live in order: build, `setup.sh`, fill `.env` keys and owner phone, `fnfctl.sh daemon-login` + QR, text F&F from the owner phone, `fnfctl.sh owner-chat Reef`, `fnfctl.sh start`, `fnfctl.sh status`, how to read `.instinct/audit.jsonl`).

- [ ] **Step 4: Run the test**

Run: `bash deploy/fnf/test.sh`
Expected: `ok` lines for every assertion.

- [ ] **Step 5: Commit**

```bash
git add deploy/fnf
git commit -m "feat(deploy): F&F setup script, launchd services and runbook"
```

---

### Task 8: Go-live on the Mac (manual, after the owner links the number)

**Files:** none in the repo; produces `~/F&F/.env`, `~/F&F/.instinct/`, two LaunchAgents.

- [ ] **Step 1:** `corepack pnpm@10.6.1 -r build && bash deploy/fnf/setup.sh`
- [ ] **Step 2:** Owner fills `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (optional), `INSTINCT_OWNER_PHONE` in `.env`.
- [ ] **Step 3:** `bash deploy/fnf/fnfctl.sh daemon-login`; owner scans the QR from F&F's WhatsApp account; wait for `ready`.
- [ ] **Step 4:** Owner texts F&F's number "hi" from their phone. `bash deploy/fnf/fnfctl.sh owner-chat Reef`; owner clicks Approve on the native dialog.
- [ ] **Step 5:** `bash deploy/fnf/fnfctl.sh start && bash deploy/fnf/fnfctl.sh status`
  Expected: both services `state = running`; `curl -H "Authorization: Bearer $TOKEN" 127.0.0.1:8080/status` shows `whatsapp.ownerChat`.
- [ ] **Step 6:** Owner texts "מה אתה יודע לעשות?" and gets one Hebrew reply within 30 s; `.instinct/audit.jsonl` shows one `inbound` and one `outbound` entry. Then the onboarding runs and a daily brief is scheduled.
