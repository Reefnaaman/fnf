/**
 * An in-process stand-in for the whatsapp-connector daemon: the same `POST /rpc`
 * over a unix socket and the same JSON shapes as daemon/src/control-server.js.
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeChat { id: string; name: string; unread?: number }
export interface FakeMessage { id: string; sender: string; ts: number; text: string; hasMedia: boolean; media?: { mimetype: string; filename?: string; bytes?: Buffer } }

export interface FakeDaemon {
  socketPath: string;
  chats: FakeChat[];
  sent: Array<{ chatId: string; text: string }>;
  confirms: number;
  failConfirm: boolean;
  ready: boolean;
  allow: string[];
  /** Delay every answer by this many ms (timeout tests). */
  delayMs: number;
  /** Close the socket right after the response headers (M2: res 'error' path). */
  abortAfterHeaders: boolean;
  messagesFor(chatId: string): FakeMessage[];
  push(chatId: string, msg: FakeMessage): void;
  close(): Promise<void>;
}

export async function startFakeDaemon(opts: { ready?: boolean } = {}): Promise<FakeDaemon> {
  const dir = mkdtempSync(join(tmpdir(), "wa-"));
  const socketPath = join(dir, "c.sock");
  const messages = new Map<string, FakeMessage[]>();
  const pending = new Map<string, { chatId: string; text: string }>();
  let tokenSeq = 0;
  const d: FakeDaemon = {
    socketPath,
    chats: [],
    sent: [],
    confirms: 0,
    failConfirm: false,
    ready: opts.ready ?? true,
    allow: ["*"],
    delayMs: 0,
    abortAfterHeaders: false,
    messagesFor: (chatId) => messages.get(chatId) ?? [],
    push: (chatId, msg) => { messages.set(chatId, [...(messages.get(chatId) ?? []), msg]); },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const err = (message: string, code: string) => ({ ok: false, error: message, code });
  const resolve = (ref: string) => d.chats.find((c) => c.id === ref || c.name === ref);
  const ensureReady = () => { if (!d.ready) throw Object.assign(new Error("WhatsApp session not ready (state: starting)"), { code: "NOT_READY" }); };
  const allowed = (id: string) => d.allow.includes("*") || d.allow.includes(id);
  function handle(cmd: string, args: Record<string, any>): unknown {
    switch (cmd) {
      case "status": return { state: d.ready ? "ready" : "starting", ready: d.ready, syncPercent: d.ready ? 100 : null };
      case "chats": ensureReady(); return d.chats.map((c) => ({ id: c.id, name: c.name, unread: c.unread ?? 0 }));
      case "read": {
        ensureReady();
        const chat = resolve(args.chat); if (!chat) throw Object.assign(new Error(`chat not found: ${args.chat}`), { code: "NOT_FOUND" });
        const all = messages.get(chat.id) ?? [];
        const limit = args.all ? all.length : Math.min(Number(args.limit ?? 30), 200);
        return { chat: chat.name, id: chat.id, messages: all.slice(-limit).map(({ media, ...m }) => m) };
      }
      case "send": {
        const chat = resolve(args.chat); if (!chat) throw Object.assign(new Error(`chat not found: ${args.chat}`), { code: "NOT_FOUND" });
        if (!allowed(chat.id)) throw Object.assign(new Error(`chat "${chat.name}" (${chat.id}) is not on the send allow-list`), { code: "NOT_ALLOWED" });
        ensureReady();
        const token = `t${++tokenSeq}`; pending.set(token, { chatId: chat.id, text: args.text });
        return { pending: true, token, chat: chat.name, id: chat.id, preview: args.text };
      }
      case "sendConfirm": {
        const p = pending.get(args.token); pending.delete(args.token);
        if (!p) throw Object.assign(new Error("no pending send for that token (invalid or already used)"), { code: "NO_PENDING" });
        if (d.failConfirm) throw Object.assign(new Error("socket hang up"), { code: "ERR" });
        ensureReady();
        d.sent.push(p); d.confirms += 1;
        return { id: `msg_${d.sent.length}` };
      }
      case "media": {
        ensureReady();
        const chat = resolve(args.chat); if (!chat) throw Object.assign(new Error(`chat not found: ${args.chat}`), { code: "NOT_FOUND" });
        const m = (messages.get(chat.id) ?? []).find((x) => x.id === args.messageId);
        if (!m?.media) throw Object.assign(new Error("message has no media"), { code: "NO_MEDIA" });
        const mdir = mkdtempSync(join(tmpdir(), "wa-media-"));
        const ext = (m.media.mimetype || "application/bin").split("/")[1]?.split(";")[0] ?? "bin";
        const file = join(mdir, m.media.filename ?? `media.${ext}`);
        writeFileSync(file, m.media.bytes ?? Buffer.from("media"));
        return m.media.mimetype === "" ? { path: file } : { path: file, mimetype: m.media.mimetype };
      }
      case "allowList": return d.allow;
      default: throw Object.assign(new Error(`unknown command: ${cmd}`), { code: "UNKNOWN_CMD" });
    }
  }
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let out: unknown;
      try {
        const { cmd, args = {} } = JSON.parse(body || "{}");
        out = { ok: true, data: handle(cmd, args) };
      } catch (e) {
        const x = e as Error & { code?: string };
        out = err(x.message, x.code ?? "ERR");
      }
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        if (d.abortAfterHeaders) { res.flushHeaders(); res.socket?.destroy(); return; }
        res.end(JSON.stringify(out));
      }, d.delayMs);
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
  return d;
}
