/**
 * The inbound side: poll the owner's chat through the daemon and hand each new
 * message to the runtime. The daemon has no push, so this is a loop with backoff.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { extname, join } from "node:path";
import type { InboundMessage } from "@open-instinct/core";
import { Cursor } from "./cursor.js";
import { DaemonError, type DaemonRpc } from "./rpc.js";

export interface DaemonMessage {
  id: string;
  sender: string;
  /** Unix seconds. */
  ts: number;
  text: string;
  hasMedia: boolean;
}

export interface WhatsAppInboxOptions {
  rpc: DaemonRpc;
  ownerChatId: string;
  ownerPhone: string;
  cursorFile: string;
  /** Downloaded media lands here (the workspace's inbound folder). */
  inboundDir: string;
  onMessage: (m: InboundMessage) => Promise<unknown>;
  logger?: (m: string) => void;
  /** Base poll interval. Default 2000 ms. */
  pollMs?: number;
  /** How many recent messages to read per poll. Default 50. */
  readLimit?: number;
  transcribe?: (path: string, mimetype: string) => Promise<string>;
  now?: () => Date;
}

export const DEFAULT_POLL_MS = 2000;
export const MAX_POLL_MS = 30_000;
/** Messages this many seconds before the high-water mark are still considered new (clock skew, late sync). */
export const GRACE_SECONDS = 60;
const DEFAULT_READ_LIMIT = 50;
const TRANSIENT_CODES: ReadonlySet<string> = new Set(["DAEMON_DOWN", "NOT_READY"]);

export class WhatsAppInbox {
  readonly cursorFile: string;
  private readonly rpc: DaemonRpc;
  private readonly ownerChatId: string;
  private readonly ownerPhone: string;
  private readonly inboundDir: string;
  private readonly onMessage: WhatsAppInboxOptions["onMessage"];
  private readonly log: (m: string) => void;
  private readonly pollMs: number;
  private readonly readLimit: number;
  private readonly transcribe: WhatsAppInboxOptions["transcribe"];
  private readonly now: () => Date;
  private readonly cursor: Cursor;
  private failures = 0;
  private outage = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(opts: WhatsAppInboxOptions) {
    this.rpc = opts.rpc;
    this.ownerChatId = opts.ownerChatId;
    this.ownerPhone = opts.ownerPhone;
    this.cursorFile = opts.cursorFile;
    this.inboundDir = opts.inboundDir;
    this.onMessage = opts.onMessage;
    this.log = opts.logger ?? (() => undefined);
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    this.readLimit = opts.readLimit ?? DEFAULT_READ_LIMIT;
    this.transcribe = opts.transcribe;
    this.now = opts.now ?? (() => new Date());
    this.cursor = new Cursor(this.cursorFile);
    this.cursor.initIfEmpty(Math.floor(this.now().getTime() / 1000));
  }

  /** The wait before the next poll: the base interval, doubled per failed poll up to MAX_POLL_MS. */
  get delayMs(): number {
    return Math.min(this.pollMs * 2 ** this.failures, MAX_POLL_MS);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = async (): Promise<void> => {
      if (!this.running) return;
      try {
        await this.pollOnce();
      } catch (err) {
        this.log(`whatsapp: poll failed: ${(err as Error).message}`);
      }
      if (this.running) this.timer = setTimeout(() => void tick(), this.delayMs);
    };
    this.timer = setTimeout(() => void tick(), 0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Read the owner's chat once. Returns how many new messages were handed to the runtime. */
  async pollOnce(): Promise<number> {
    let batch: { messages: DaemonMessage[] };
    try {
      batch = await this.rpc.call<{ messages: DaemonMessage[] }>("read", { chat: this.ownerChatId, limit: this.readLimit });
    } catch (err) {
      if (err instanceof DaemonError && TRANSIENT_CODES.has(err.code)) {
        this.failures += 1;
        if (!this.outage) {
          this.outage = true;
          this.log(`whatsapp: daemon unavailable (${err.code}); polling backs off up to ${MAX_POLL_MS / 1000}s`);
        }
        return 0;
      }
      throw err;
    }
    if (this.outage) {
      this.outage = false;
      this.log("whatsapp: daemon back; polling resumed");
    }
    this.failures = 0;

    const floor = this.cursor.highWater() - GRACE_SECONDS;
    const fresh = batch.messages
      .filter((m) => m.sender !== "me" && m.ts >= floor && !this.cursor.seen(m.id))
      .sort((a, b) => a.ts - b.ts);
    let handled = 0;
    for (const m of fresh) {
      const inbound = await this.toInbound(m);
      try {
        await this.onMessage(inbound);
      } catch (err) {
        this.log(`whatsapp: runtime rejected ${m.id}: ${(err as Error).message}`);
      }
      // Marked even on failure: at-most-once, never a reply loop on a poisoned message.
      this.cursor.mark(m.id, m.ts);
      handled += 1;
    }
    return handled;
  }

  private async toInbound(m: DaemonMessage): Promise<InboundMessage> {
    const base: InboundMessage = {
      id: m.id,
      channel: "whatsapp",
      conversationKey: `whatsapp:${this.ownerChatId}`,
      from: this.ownerPhone,
      text: m.text ?? "",
      replyRef: { chatId: this.ownerChatId, messageId: m.id },
      receivedAt: new Date(m.ts * 1000).toISOString(),
    };
    if (!m.hasMedia) return base;
    let media: { path: string; mimetype: string };
    try {
      media = await this.rpc.call<{ path: string; mimetype: string }>("media", { chat: this.ownerChatId, messageId: m.id });
    } catch (err) {
      this.log(`whatsapp: media for ${m.id} unavailable: ${(err as Error).message}`);
      return { ...base, text: base.text || "[attachment, could not be downloaded]" };
    }
    const path = this.keepMedia(m.id, media);
    const kind = media.mimetype.split("/")[0];
    let text = base.text;
    if (kind === "audio") {
      if (this.transcribe) {
        try {
          text = `[voice note] ${await this.transcribe(path, media.mimetype)}`;
        } catch (err) {
          this.log(`whatsapp: transcription of ${m.id} failed: ${(err as Error).message}`);
          text = "[voice note, not transcribed]";
        }
      } else {
        text = "[voice note, not transcribed]";
      }
    } else if (!text) {
      text = kind === "image" ? "[photo]" : kind === "video" ? "[video]" : `[document: ${path.split("/").pop() ?? "file"}]`;
    }
    return { ...base, text, attachments: [{ path, mimeType: media.mimetype }] };
  }

  private keepMedia(messageId: string, media: { path: string; mimetype: string }): string {
    mkdirSync(this.inboundDir, { recursive: true });
    const ext = extname(media.path) || `.${media.mimetype.split("/")[1]?.split(";")[0] ?? "bin"}`;
    const safe = messageId.replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 80);
    const target = join(this.inboundDir, `${safe}${ext}`);
    copyFileSync(media.path, target);
    return target;
  }
}
