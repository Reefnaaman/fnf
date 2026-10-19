import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Principal } from "@open-instinct/core";
import { WHATSAPP_MAX_CHARS, WhatsAppChannel, splitMessageText } from "../src/channel.js";
import { OutboxQueue } from "../src/queue.js";
import { DaemonRpc } from "../src/rpc.js";
import { startFakeDaemon, type FakeDaemon } from "./fake-daemon.js";

const OWNER_CHAT = "972501234567@c.us";
const OWNER_PHONE = "+972501234567";
const owner: Principal = { kind: "owner", id: "owner", tier: "owner", displayName: "Reef", phone: OWNER_PHONE };
const ctx = { principal: owner, conversationKey: `whatsapp:${OWNER_CHAT}` };

const daemons: FakeDaemon[] = [];
afterEach(async () => { for (const d of daemons.splice(0)) await d.close().catch(() => undefined); });

async function setup(opts: { ready?: boolean } = {}) {
  const d = await startFakeDaemon(opts); daemons.push(d);
  d.chats.push({ id: OWNER_CHAT, name: "Reef" }, { id: "15550000000@c.us", name: "Someone" });
  const queue = new OutboxQueue(join(mkdtempSync(join(tmpdir(), "wac-")), "whatsapp-outbox.json"));
  const logs: string[] = [];
  const ch = new WhatsAppChannel({ rpc: new DaemonRpc({ socketPath: d.socketPath, timeoutMs: 2000 }), ownerChatId: OWNER_CHAT, ownerPhone: OWNER_PHONE, queue, logger: (m) => logs.push(m) });
  return { d, ch, queue, logs };
}

describe("splitMessageText", () => {
  it("splits a 4000-char reply into bubbles of at most 3000 chars on a paragraph break", () => {
    const para1 = "a".repeat(2500);
    const para2 = "b".repeat(1500);
    const parts = splitMessageText(`${para1}\n\n${para2}`);
    expect(parts).toEqual([para1, para2]);
    expect(parts.every((p) => p.length <= WHATSAPP_MAX_CHARS)).toBe(true);
    expect(WHATSAPP_MAX_CHARS).toBe(3000);
  });
});

describe("WhatsAppChannel.send", () => {
  it("sends the owner's reply in order through send + sendConfirm", async () => {
    const { d, ch } = await setup();
    const text = `${"x".repeat(2900)}\n\n${"y".repeat(500)}`;
    await ch.send({ channel: "whatsapp", conversationKey: `whatsapp:${OWNER_CHAT}`, text }, ctx);
    expect(d.sent).toEqual([{ chatId: OWNER_CHAT, text: "x".repeat(2900) }, { chatId: OWNER_CHAT, text: "y".repeat(500) }]);
    expect(d.confirms).toBe(2);
  });

  it("reaches the owner by phone number too", async () => {
    const { d, ch } = await setup();
    await ch.send({ channel: "whatsapp", to: "+972 50-123-4567", text: "brief" }, ctx);
    expect(d.sent).toEqual([{ chatId: OWNER_CHAT, text: "brief" }]);
  });

  it("refuses any chat but the owner's before touching the daemon", async () => {
    const { d, ch } = await setup();
    await expect(ch.send({ channel: "whatsapp", to: "+15550000000", text: "x" }, ctx)).rejects.toMatchObject({ code: "NOT_OWNER" });
    await expect(ch.send({ channel: "whatsapp", conversationKey: "whatsapp:15550000000@c.us", text: "x" }, ctx)).rejects.toMatchObject({ code: "NOT_OWNER" });
    expect(d.sent).toHaveLength(0);
  });

  it("queues when send fails before confirm and flushes with a (delayed) prefix", async () => {
    const { d, ch, queue, logs } = await setup({ ready: false });
    await ch.send({ channel: "whatsapp", conversationKey: `whatsapp:${OWNER_CHAT}`, text: "morning brief" }, ctx);
    expect(d.sent).toHaveLength(0);
    expect(queue.size()).toBe(1);
    expect(logs.some((l) => /queued/.test(l))).toBe(true);
    d.ready = true;
    expect(await ch.flushQueue()).toBe(1);
    expect(d.sent).toEqual([{ chatId: OWNER_CHAT, text: "(delayed) morning brief" }]);
    expect(queue.size()).toBe(0);
  });

  it("does not retry and does not queue when sendConfirm fails", async () => {
    const { d, ch, queue } = await setup();
    d.failConfirm = true;
    await expect(ch.send({ channel: "whatsapp", conversationKey: `whatsapp:${OWNER_CHAT}`, text: "hi" }, ctx)).rejects.toMatchObject({ code: "ERR" });
    expect(d.sent).toHaveLength(0);
    expect(queue.size()).toBe(0);
    expect(d.confirms).toBe(0);
  });

  it("typing is a no-op", async () => {
    const { ch } = await setup();
    await expect(ch.typing(`whatsapp:${OWNER_CHAT}`)).resolves.toBeUndefined();
  });
});

describe("WhatsAppChannel ordering and flush safety", () => {
  it("while texts are queued, a new send is queued behind them instead of overtaking", async () => {
    const { d, ch, queue } = await setup({ ready: false });
    await ch.send({ channel: "whatsapp", conversationKey: `whatsapp:${OWNER_CHAT}`, text: "first" }, ctx);
    d.ready = true;
    await ch.send({ channel: "whatsapp", conversationKey: `whatsapp:${OWNER_CHAT}`, text: "second" }, ctx);
    expect(d.sent).toEqual([]);
    expect(queue.size()).toBe(2);
    expect(await ch.flushQueue()).toBe(2);
    expect(d.sent.map((s) => s.text)).toEqual(["(delayed) first", "(delayed) second"]);
  });

  it("a confirm failure mid-flush keeps the remaining entries queued", async () => {
    const { d, ch, queue } = await setup({ ready: false });
    await ch.send({ channel: "whatsapp", conversationKey: `whatsapp:${OWNER_CHAT}`, text: "one" }, ctx);
    await ch.send({ channel: "whatsapp", conversationKey: `whatsapp:${OWNER_CHAT}`, text: "two" }, ctx);
    d.ready = true;
    d.failConfirm = true;
    await expect(ch.flushQueue()).rejects.toMatchObject({ code: "ERR" });
    expect(queue.size()).toBe(1);
    d.failConfirm = false;
    expect(await ch.flushQueue()).toBe(1);
    expect(d.sent.map((s) => s.text)).toEqual(["(delayed) two"]);
  });

  it("refuses to confirm when the daemon resolved a different chat than the owner's", async () => {
    const { d, ch } = await setup();
    d.chats.length = 0;
    d.chats.push({ id: "15550000000@c.us", name: OWNER_CHAT }); // a chat whose *name* equals the owner id
    await expect(ch.send({ channel: "whatsapp", conversationKey: `whatsapp:${OWNER_CHAT}`, text: "x" }, ctx)).rejects.toMatchObject({ code: "WRONG_CHAT" });
    expect(d.confirms).toBe(0);
  });
});
