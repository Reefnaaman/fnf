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
  /** Runs after every successful read (daemon reachable), for example to flush queued texts. */
  afterPoll?: () => Promise<unknown>;
  now?: () => Date;
}

export const DEFAULT_POLL_MS = 2000;
export const MAX_POLL_MS = 30_000;
/** Messages this many seconds before the high-water mark are still considered new (clock skew, late sync). */
export const GRACE_SECONDS = 60;
/** An empty text with no media (deleted, or not yet decrypted) is left alone this long before it is written off. */
export const EMPTY_TEXT_GRACE_SECONDS = 300;
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
  private readonly afterPoll: WhatsAppInboxOptions["afterPoll"];
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
    this.afterPoll = opts.afterPoll;
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
    let batch: { id?: string; messages: DaemonMessage[] };
    try {
      batch = await this.rpc.call<{ id?: string; messages: DaemonMessage[] }>("read", { chat: this.ownerChatId, limit: this.readLimit });
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
    // The daemon resolves a chat by id, then by name. Anything but the pinned id is not the owner.
    if (batch.id !== undefined && batch.id !== this.ownerChatId) {
      this.failures += 1;
      if (!this.outage) {
        this.outage = true;
        this.log(`whatsapp: daemon resolved to ${batch.id}, not the owner chat ${this.ownerChatId}; reading nothing until it matches`);
      }
      return 0;
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
    const nowSec = Math.floor(this.now().getTime() / 1000);
    let handled = 0;
    for (const m of fresh) {
      if (!m.hasMedia && !(m.text ?? "").trim()) {
        // Deleted for everyone, or not decrypted yet: wait, then write it off.
        if (nowSec - m.ts > EMPTY_TEXT_GRACE_SECONDS) this.cursor.mark(m.id, m.ts);
        continue;
      }
      let inbound: InboundMessage;
      try {
        inbound = await this.toInbound(m);
      } catch (err) {
        this.log(`whatsapp: could not process ${m.id}: ${(err as Error).message}`);
        inbound = { ...this.baseInbound(m), text: (m.text ?? "").trim() || "[attachment, could not be processed]" };
      }
      try {
        await this.onMessage(inbound);
      } catch (err) {
        this.log(`whatsapp: runtime rejected ${m.id}: ${(err as Error).message}`);
      }
      // Marked even on failure: at-most-once, never a reply loop on a poisoned message.
      this.cursor.mark(m.id, m.ts);
      handled += 1;
    }
    if (this.afterPoll) {
      try {
        await this.afterPoll();
      } catch (err) {
        this.log(`whatsapp: after-poll hook failed: ${(err as Error).message}`);
      }
    }
    return handled;
  }

  private baseInbound(m: DaemonMessage): InboundMessage {
    return {
      id: m.id,
      channel: "whatsapp",
      conversationKey: `whatsapp:${this.ownerChatId}`,
      from: this.ownerPhone,
      text: m.text ?? "",
      replyRef: { chatId: this.ownerChatId, messageId: m.id },
      receivedAt: new Date(m.ts * 1000).toISOString(),
    };
  }

  private async toInbound(m: DaemonMessage): Promise<InboundMessage> {
    const base = this.baseInbound(m);
    if (!m.hasMedia) return base;
    let media: { path: string; mimetype?: string };
    try {
      media = await this.rpc.call<{ path: string; mimetype?: string }>("media", { chat: this.ownerChatId, messageId: m.id });
    } catch (err) {
      this.log(`whatsapp: media for ${m.id} unavailable: ${(err as Error).message}`);
      return { ...base, text: base.text || "[attachment, could not be downloaded]" };
    }
    if (!media.mimetype || !media.path) throw new Error("daemon returned media without a path or mimetype");
    const path = this.keepMedia(m.id, { path: media.path, mimetype: media.mimetype });
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
    return { ...base, text, attachments: [{ path, mimeType: media.mimetype, name: media.path.split("/").pop() ?? "file" }] };
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
