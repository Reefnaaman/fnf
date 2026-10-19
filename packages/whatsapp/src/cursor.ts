/**
 * Where the poller is in the owner's chat. Persisted so a restart of either process
 * never replays history: the daemon re-syncs old messages on boot with their old ids.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SEEN_MAX = 500;

interface CursorFile {
  /** Unix seconds of the newest message processed (or the boot time on first run). */
  highWater: number;
  seen: string[];
}

export class Cursor {
  private readonly file: string;
  private data: CursorFile;

  constructor(file: string) {
    this.file = file;
    this.data = this.read();
  }

  seen(id: string): boolean {
    return this.data.seen.includes(id);
  }

  mark(id: string, ts: number): void {
    const seen = [...this.data.seen.filter((x) => x !== id), id].slice(-SEEN_MAX);
    this.data = { highWater: Math.max(this.data.highWater, ts), seen };
    this.write();
  }

  highWater(): number {
    return this.data.highWater;
  }

  /** On the very first run, start from now so history is never processed. */
  initIfEmpty(nowSeconds: number): void {
    if (this.data.highWater > 0) return;
    this.data = { highWater: nowSeconds, seen: [] };
    this.write();
  }

  private read(): CursorFile {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<CursorFile>;
      return { highWater: typeof parsed.highWater === "number" ? parsed.highWater : 0, seen: Array.isArray(parsed.seen) ? parsed.seen.filter((x): x is string => typeof x === "string") : [] };
    } catch {
      return { highWater: 0, seen: [] };
    }
  }

  private write(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}
