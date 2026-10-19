import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OutboxQueue } from "../src/queue.js";

const file = () => join(mkdtempSync(join(tmpdir(), "waq-")), "whatsapp-outbox.json");

describe("OutboxQueue", () => {
  it("persists entries across instances and drains them in order", () => {
    const f = file();
    const q = new OutboxQueue(f);
    q.push({ chatId: "c@c.us", text: "one", at: "2026-10-19T08:00:00Z" });
    q.push({ chatId: "c@c.us", text: "two", at: "2026-10-19T08:00:01Z" });
    expect(new OutboxQueue(f).size()).toBe(2);
    const { entries, expired } = new OutboxQueue(f).drain();
    expect(entries.map((e) => e.text)).toEqual(["one", "two"]);
    expect(expired).toEqual([]);
    expect(new OutboxQueue(f).size()).toBe(0);
  });

  it("drain drops entries older than 12 hours", () => {
    const now = new Date("2026-10-19T20:00:00Z");
    const q = new OutboxQueue(file(), { now: () => now });
    q.push({ chatId: "c@c.us", text: "stale", at: "2026-10-19T07:59:59Z" });
    q.push({ chatId: "c@c.us", text: "fresh", at: "2026-10-19T08:00:01Z" });
    const { entries, expired } = q.drain();
    expect(entries.map((e) => e.text)).toEqual(["fresh"]);
    expect(expired.map((e) => e.text)).toEqual(["stale"]);
  });
});
