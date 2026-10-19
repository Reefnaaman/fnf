/**
 * Texts that could not be handed to the daemon (down or not ready) wait here and are
 * flushed when it is back. Only sends that failed *before* `sendConfirm` are queued:
 * delivery is at-most-once, so an ambiguous confirm is never retried.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface QueueEntry {
  chatId: string;
  text: string;
  /** ISO time the text was first attempted. */
  at: string;
}

export interface OutboxQueueOptions {
  /** Entries older than this are dropped on drain. Default 12 hours. */
  maxAgeMs?: number;
  now?: () => Date;
}

export const DEFAULT_QUEUE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export class OutboxQueue {
  private readonly file: string;
  private readonly maxAgeMs: number;
  private readonly now: () => Date;

  constructor(file: string, opts: OutboxQueueOptions = {}) {
    this.file = file;
    this.maxAgeMs = opts.maxAgeMs ?? DEFAULT_QUEUE_MAX_AGE_MS;
    this.now = opts.now ?? (() => new Date());
  }

  push(entry: QueueEntry): void {
    this.write([...this.read(), entry]);
  }

  /** Remove everything from the file; fresh entries come back in order, stale ones separately. */
  drain(): { entries: QueueEntry[]; expired: QueueEntry[] } {
    const all = this.read();
    this.write([]);
    const cutoff = this.now().getTime() - this.maxAgeMs;
    const entries: QueueEntry[] = [];
    const expired: QueueEntry[] = [];
    for (const e of all) (Date.parse(e.at) >= cutoff ? entries : expired).push(e);
    return { entries, expired };
  }

  size(): number {
    return this.read().length;
  }

  private read(): QueueEntry[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      return Array.isArray(parsed) ? (parsed as QueueEntry[]) : [];
    } catch {
      return [];
    }
  }

  private write(entries: QueueEntry[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}
