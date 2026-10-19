/**
 * The Outbox for WhatsApp. One target only: the owner's chat. Every bubble goes
 * through the daemon's two-step send (`send` returns a token, `sendConfirm`
 * transmits), so the daemon's allow-list is checked on both calls.
 */
import { normalizePhone, type OutboundMessage, type Outbox, type Principal } from "@open-instinct/core";
import { DaemonError, type DaemonRpc } from "./rpc.js";
import { splitMessageText, WHATSAPP_MAX_CHARS } from "./split.js";
import type { OutboxQueue, QueueEntry } from "./queue.js";

export { splitMessageText, WHATSAPP_MAX_CHARS };

export interface WhatsAppChannelOptions {
  rpc: DaemonRpc;
  /** The daemon chat id of the owner's 1:1 chat (`…@c.us` or `…@lid`). */
  ownerChatId: string;
  /** The owner's phone, E.164; `to: <this>` resolves to the owner chat. */
  ownerPhone: string;
  queue: OutboxQueue;
  logger?: (m: string) => void;
  now?: () => Date;
}

export const CONVERSATION_PREFIX = "whatsapp:";
export const DELAYED_PREFIX = "(delayed) ";

/** Daemon errors that mean "try again later" rather than "this will never work". */
const TRANSIENT_CODES: ReadonlySet<string> = new Set(["DAEMON_DOWN", "NOT_READY"]);

interface SendResult {
  pending: boolean;
  token: string;
  /** The chat id the daemon actually resolved; must be the owner chat. */
  id?: string;
}

export class WhatsAppChannel implements Outbox {
  private readonly rpc: DaemonRpc;
  readonly ownerChatId: string;
  private readonly ownerPhone: string;
  private readonly queue: OutboxQueue;
  private readonly log: (m: string) => void;
  private readonly now: () => Date;
  private flushing: Promise<number> | undefined;

  constructor(opts: WhatsAppChannelOptions) {
    this.rpc = opts.rpc;
    this.ownerChatId = opts.ownerChatId;
    this.ownerPhone = normalizePhone(opts.ownerPhone);
    this.queue = opts.queue;
    this.log = opts.logger ?? (() => undefined);
    this.now = opts.now ?? (() => new Date());
  }

  async send(msg: OutboundMessage, _ctx: { principal: Principal; conversationKey: string }): Promise<void> {
    const chatId = this.resolveTarget(msg);
    const parts = splitMessageText(msg.text);
    // Texts already waiting go first: a new reply must not overtake the queue.
    if (this.queue.size() > 0) {
      const at = this.now().toISOString();
      for (const text of parts) this.queue.push({ chatId, text, at });
      this.log(`whatsapp: ${parts.length} part(s) queued behind ${this.queue.size() - parts.length} waiting text(s)`);
      return;
    }
    for (let i = 0; i < parts.length; i += 1) {
      const text = parts[i]!;
      let token: string;
      try {
        token = await this.beginSend(chatId, text);
      } catch (err) {
        if (err instanceof DaemonError && TRANSIENT_CODES.has(err.code)) {
          const at = this.now().toISOString();
          for (const rest of parts.slice(i)) this.queue.push({ chatId, text: rest, at });
          this.log(`whatsapp: daemon unavailable (${err.code}); queued ${parts.length - i} part(s) for the owner`);
          return;
        }
        throw err;
      }
      // At-most-once: a failed or ambiguous confirm propagates and is never retried.
      await this.rpc.call("sendConfirm", { token });
    }
  }

  async typing(_conversationKey: string): Promise<void> {
    // The daemon has no typing indicator.
  }

  /** `send` on the daemon, checked: the resolved chat must be the one we asked for. */
  private async beginSend(chatId: string, text: string): Promise<string> {
    const result = await this.rpc.call<SendResult>("send", { chat: chatId, text });
    if (result.id !== undefined && result.id !== chatId) {
      throw new DaemonError(`daemon resolved "${chatId}" to ${result.id}; refusing to send outside the owner chat`, "WRONG_CHAT");
    }
    return result.token;
  }

  /** Send what was queued while the daemon was away. Returns how many texts went out. One flush at a time. */
  flushQueue(): Promise<number> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushNow().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  private async flushNow(): Promise<number> {
    if (this.queue.size() === 0) return 0;
    const { entries, expired } = this.queue.drain();
    if (expired.length > 0) this.log(`whatsapp: dropped ${expired.length} queued text(s) older than the queue limit`);
    let sent = 0;
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]!;
      let token: string;
      try {
        token = await this.beginSend(entry.chatId, `${DELAYED_PREFIX}${entry.text}`);
      } catch (err) {
        if (err instanceof DaemonError && TRANSIENT_CODES.has(err.code)) {
          for (const rest of entries.slice(i)) this.queue.push(rest);
          this.log(`whatsapp: daemon still unavailable (${err.code}); ${entries.length - i} text(s) stay queued`);
          return sent;
        }
        // Not transient: this entry is dropped, the rest stay for the next flush.
        for (const rest of entries.slice(i + 1)) this.queue.push(rest);
        throw err;
      }
      try {
        await this.rpc.call("sendConfirm", { token });
      } catch (err) {
        // At-most-once: never retry this one; keep the rest.
        for (const rest of entries.slice(i + 1)) this.queue.push(rest);
        throw err;
      }
      sent += 1;
    }
    return sent;
  }

  private resolveTarget(msg: OutboundMessage): string {
    if (msg.conversationKey) {
      if (msg.conversationKey === `${CONVERSATION_PREFIX}${this.ownerChatId}`) return this.ownerChatId;
      throw new DaemonError(`WhatsApp sends are limited to the owner's chat; refused ${msg.conversationKey}`, "NOT_OWNER");
    }
    const targets = Array.isArray(msg.to) ? msg.to : msg.to ? [msg.to] : [];
    if (targets.length === 1 && normalizePhone(targets[0]!) === this.ownerPhone) return this.ownerChatId;
    throw new DaemonError(`WhatsApp sends are limited to the owner's chat; refused ${targets.join(",") || "(no target)"}`, "NOT_OWNER");
  }
}

export type { QueueEntry };
