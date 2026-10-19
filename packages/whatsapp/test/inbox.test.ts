import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { InboundMessage } from "@open-instinct/core";
import { Cursor } from "../src/cursor.js";
import { WhatsAppInbox } from "../src/inbox.js";
import { DaemonRpc } from "../src/rpc.js";
import { startFakeDaemon, type FakeDaemon } from "./fake-daemon.js";

const OWNER_CHAT = "972501234567@c.us";
const OTHER_CHAT = "15550000000@c.us";
const OWNER_PHONE = "+972501234567";

const daemons: FakeDaemon[] = [];
afterEach(async () => { for (const d of daemons.splice(0)) await d.close().catch(() => undefined); });

async function setup(opts: { cursorFile?: string; transcribe?: (path: string, mimetype: string) => Promise<string>; now?: () => Date; ready?: boolean } = {}) {
  const d = await startFakeDaemon({ ready: opts.ready }); daemons.push(d);
  d.chats.push({ id: OWNER_CHAT, name: "Reef" }, { id: OTHER_CHAT, name: "Someone" });
  const dir = mkdtempSync(join(tmpdir(), "wai-"));
  const received: InboundMessage[] = [];
  const logs: string[] = [];
  const inbox = new WhatsAppInbox({
    rpc: new DaemonRpc({ socketPath: d.socketPath, timeoutMs: 2000 }),
    ownerChatId: OWNER_CHAT,
    ownerPhone: OWNER_PHONE,
    cursorFile: opts.cursorFile ?? join(dir, "whatsapp-cursor.json"),
    inboundDir: join(dir, "inbound"),
    onMessage: async (m) => { received.push(m); },
    logger: (m) => logs.push(m),
    ...(opts.transcribe ? { transcribe: opts.transcribe } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { d, inbox, received, logs, dir };
}

const nowSec = () => Math.floor(Date.now() / 1000);
const text = (id: string, sender: string, body: string, ts = nowSec()) => ({ id, sender, ts, text: body, hasMedia: false });

describe("Cursor", () => {
  it("persists the high-water mark and the last 500 seen ids", () => {
    const f = join(mkdtempSync(join(tmpdir(), "wacur-")), "c.json");
    const c = new Cursor(f);
    c.initIfEmpty(1000);
    for (let i = 0; i < 600; i += 1) c.mark(`m${i}`, 1000 + i);
    const again = new Cursor(f);
    expect(again.highWater()).toBe(1599);
    expect(again.seen("m599")).toBe(true);
    expect(again.seen("m0")).toBe(false);
    again.initIfEmpty(5);
    expect(again.highWater()).toBe(1599);
  });
});

describe("WhatsAppInbox.pollOnce", () => {
  it("processes only new owner messages, oldest first, and never its own", async () => {
    const { d, inbox, received } = await setup();
    const t = nowSec();
    d.push(OWNER_CHAT, text("m1", "me", "my own reply", t));
    d.push(OWNER_CHAT, text("m2", "Reef", "hello", t + 1));
    d.push(OWNER_CHAT, text("m3", "Reef", "second", t + 2));
    d.push(OTHER_CHAT, text("x1", "Someone", "psst", t + 3));
    expect(await inbox.pollOnce()).toBe(2);
    expect(received.map((m) => m.text)).toEqual(["hello", "second"]);
    expect(received[0]).toMatchObject({ id: "m2", channel: "whatsapp", from: OWNER_PHONE, conversationKey: `whatsapp:${OWNER_CHAT}`, replyRef: { chatId: OWNER_CHAT, messageId: "m2" } });
    expect(await inbox.pollOnce()).toBe(0);
  });

  it("does not replay history after a restart with the same cursor file", async () => {
    const first = await setup();
    first.d.push(OWNER_CHAT, text("m1", "Reef", "hello", nowSec() + 1));
    expect(await first.inbox.pollOnce()).toBe(1);
    const second = await setup({ cursorFile: first.inbox.cursorFile });
    second.d.push(OWNER_CHAT, text("m1", "Reef", "hello", nowSec() + 1));
    expect(await second.inbox.pollOnce()).toBe(0);
    expect(second.received).toEqual([]);
  });

  it("ignores anything older than a minute before the cursor on first boot", async () => {
    const { d, inbox, received } = await setup();
    d.push(OWNER_CHAT, text("old", "Reef", "from yesterday", nowSec() - 3600));
    d.push(OWNER_CHAT, text("recent", "Reef", "just now", nowSec() - 5));
    expect(await inbox.pollOnce()).toBe(1);
    expect(received.map((m) => m.text)).toEqual(["just now"]);
  });

  it("a photo without caption becomes [photo] with an attachment path inside inboundDir", async () => {
    const { d, inbox, received, dir } = await setup();
    d.push(OWNER_CHAT, { id: "p1", sender: "Reef", ts: nowSec() + 1, text: "", hasMedia: true, media: { mimetype: "image/jpeg", bytes: Buffer.from("jpegdata") } });
    expect(await inbox.pollOnce()).toBe(1);
    expect(received[0]!.text).toBe("[photo]");
    const att = received[0]!.attachments![0]!;
    expect(att.mimeType).toBe("image/jpeg");
    expect(att.path!.startsWith(join(dir, "inbound"))).toBe(true);
    expect(existsSync(att.path!)).toBe(true);
    expect(readdirSync(join(dir, "inbound"))).toHaveLength(1);
  });

  it("a voice note is transcribed when a transcriber is given, and labelled when not", async () => {
    const seen: string[] = [];
    const a = await setup({ transcribe: async (_p, mt) => { seen.push(mt); return "שלום, מה נשמע"; } });
    a.d.push(OWNER_CHAT, { id: "v1", sender: "Reef", ts: nowSec() + 1, text: "", hasMedia: true, media: { mimetype: "audio/ogg; codecs=opus" } });
    await a.inbox.pollOnce();
    expect(a.received[0]!.text).toBe("[voice note] שלום, מה נשמע");
    expect(seen).toEqual(["audio/ogg; codecs=opus"]);
    const b = await setup();
    b.d.push(OWNER_CHAT, { id: "v1", sender: "Reef", ts: nowSec() + 1, text: "", hasMedia: true, media: { mimetype: "audio/ogg" } });
    await b.inbox.pollOnce();
    expect(b.received[0]!.text).toBe("[voice note, not transcribed]");
  });

  it("backs off while the daemon is down, logs once per outage, and recovers", async () => {
    const { d, inbox, logs } = await setup({ ready: false });
    expect(inbox.delayMs).toBe(2000);
    expect(await inbox.pollOnce()).toBe(0);
    expect(inbox.delayMs).toBe(4000);
    await inbox.pollOnce();
    await inbox.pollOnce();
    await inbox.pollOnce();
    await inbox.pollOnce();
    expect(inbox.delayMs).toBe(30000);
    expect(logs.filter((l) => /daemon unavailable/.test(l))).toHaveLength(1);
    d.ready = true;
    d.push(OWNER_CHAT, text("m1", "Reef", "back", nowSec() + 1));
    expect(await inbox.pollOnce()).toBe(1);
    expect(inbox.delayMs).toBe(2000);
    expect(logs.filter((l) => /daemon back/.test(l))).toHaveLength(1);
  });
});
