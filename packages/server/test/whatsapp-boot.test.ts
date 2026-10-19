import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { boot, type BootResult } from "../src/boot.js";
import { statusJson } from "../src/http.js";
import { startFakeDaemon, type FakeDaemon } from "../../whatsapp/test/fake-daemon.js";

const OWNER_CHAT = "972501234567@c.us";
const OTHER_CHAT = "15550000000@c.us";
const OWNER_PHONE = "+972501234567";

const dirs: string[] = [];
const daemons: FakeDaemon[] = [];
const apps: BootResult[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const d of daemons.splice(0)) await d.close().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function bootWith(extra: NodeJS.ProcessEnv) {
  const dataDir = mkdtempSync(join(tmpdir(), "fnf-boot-"));
  dirs.push(dataDir);
  const env: NodeJS.ProcessEnv = {
    INSTINCT_DATA_DIR: dataDir,
    INSTINCT_OWNER_NAME: "Reef",
    INSTINCT_OWNER_PHONE: OWNER_PHONE,
    INSTINCT_OWNER_TIMEZONE: "Asia/Jerusalem",
    INSTINCT_AGENT_NAME: "F&F",
    INSTINCT_MODEL: "faux/faux-1",
    INSTINCT_COMPUTER: "none",
    INSTINCT_SKILLS_DIR: join(dataDir, "no-skills"),
    ...extra,
  };
  const faux = fauxProvider({ provider: "faux", models: [{ id: "faux-1" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const streamFn = models.streamSimple.bind(models) as unknown as StreamFn;
  const logs: string[] = [];
  const app = await boot(env, { model: faux.getModel("faux-1"), streamFn, logger: (m) => logs.push(m) });
  apps.push(app);
  return { app, logs, faux };
}

async function daemon() {
  const d = await startFakeDaemon();
  daemons.push(d);
  d.chats.push({ id: OWNER_CHAT, name: "Reef" }, { id: OTHER_CHAT, name: "Someone" });
  return d;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe("WhatsApp wiring in boot", () => {
  it("a text in the owner chat produces exactly one WhatsApp reply", async () => {
    const d = await daemon();
    const { app, faux, logs } = await bootWith({ FNF_WHATSAPP_SOCKET: d.socketPath, FNF_WHATSAPP_OWNER_CHAT: OWNER_CHAT });
    expect(app.whatsapp?.ownerChatId).toBe(OWNER_CHAT);
    expect(logs.some((l) => l.startsWith("whatsapp: on"))).toBe(true);
    faux.setResponses([fauxAssistantMessage("Hi Reef")]);
    d.push(OWNER_CHAT, { id: "m1", sender: "Reef", ts: nowSec() + 1, text: "hello", hasMedia: false });
    expect(await app.whatsapp!.inbox.pollOnce()).toBe(1);
    expect(d.sent).toEqual([{ chatId: OWNER_CHAT, text: "Hi Reef" }]);
    expect(app.state.readJson("owner-route.json", {})).toMatchObject({ channel: "whatsapp", conversationKey: `whatsapp:${OWNER_CHAT}` });
    expect(statusJson(app)).toMatchObject({ whatsapp: { ownerChat: OWNER_CHAT, queued: 0 } });
  });

  it("a message in another chat is never read", async () => {
    const d = await daemon();
    const { app } = await bootWith({ FNF_WHATSAPP_SOCKET: d.socketPath, FNF_WHATSAPP_OWNER_CHAT: OWNER_CHAT });
    d.push(OTHER_CHAT, { id: "x1", sender: "Someone", ts: nowSec() + 1, text: "hey", hasMedia: false });
    expect(await app.whatsapp!.inbox.pollOnce()).toBe(0);
    expect(d.sent).toEqual([]);
  });

  it("a scheduled result reaches the owner on WhatsApp with no prior thread", async () => {
    const d = await daemon();
    const { app, faux } = await bootWith({ FNF_WHATSAPP_SOCKET: d.socketPath, FNF_WHATSAPP_OWNER_CHAT: OWNER_CHAT });
    faux.setResponses([fauxAssistantMessage("Morning. Nothing on the calendar.")]);
    const entry = app.scheduler.create({ name: "brief", prompt: "Run the daily brief", enabled: true, nextRunAt: new Date(Date.now() + 60_000).toISOString() });
    await app.runtime.runScheduled(entry);
    expect(d.sent).toEqual([{ chatId: OWNER_CHAT, text: "Morning. Nothing on the calendar." }]);
  });

  it("socket without owner chat boots with WhatsApp disabled", async () => {
    const d = await daemon();
    const { app, logs } = await bootWith({ FNF_WHATSAPP_SOCKET: d.socketPath });
    expect(app.whatsapp).toBeUndefined();
    expect(logs.some((l) => l.includes("WhatsApp disabled"))).toBe(true);
    expect(statusJson(app).whatsapp).toBeUndefined();
  });
});

describe("WhatsApp review fixes", () => {
  it("texts queued while the daemon was away are delivered once a poll finds it back, without a restart", async () => {
    const d = await daemon();
    d.ready = false;
    const { app, faux, logs } = await bootWith({ FNF_WHATSAPP_SOCKET: d.socketPath, FNF_WHATSAPP_OWNER_CHAT: OWNER_CHAT });
    faux.setResponses([fauxAssistantMessage("Morning brief while the daemon was down.")]);
    const entry = app.scheduler.create({ name: "brief", prompt: "Run the daily brief", enabled: true, nextRunAt: new Date(Date.now() + 60_000).toISOString() });
    await app.runtime.runScheduled(entry);
    expect(d.sent).toEqual([]);
    expect(statusJson(app)).toMatchObject({ whatsapp: { queued: 1 } });
    expect(await app.whatsapp!.inbox.pollOnce()).toBe(0);
    expect(d.sent).toEqual([]);
    d.ready = true;
    await app.whatsapp!.inbox.pollOnce();
    expect(d.sent).toEqual([{ chatId: OWNER_CHAT, text: "(delayed) Morning brief while the daemon was down." }]);
    expect(statusJson(app)).toMatchObject({ whatsapp: { queued: 0 } });
    expect(logs.some((l) => /flushed 1 queued/.test(l))).toBe(true);
  });

  it("a group or a name as the owner chat disables WhatsApp with a clear line", async () => {
    const d = await daemon();
    const { app, logs } = await bootWith({ FNF_WHATSAPP_SOCKET: d.socketPath, FNF_WHATSAPP_OWNER_CHAT: "120363000000000000@g.us" });
    expect(app.whatsapp).toBeUndefined();
    expect(logs.some((l) => l.includes("not a 1:1 chat id") && l.includes("WhatsApp disabled"))).toBe(true);
  });
});
