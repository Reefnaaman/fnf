import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { transcribeAudio } from "../src/transcribe.js";

describe("transcribeAudio", () => {
  it("posts multipart with the model and returns text", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "wat-")), "note.ogg");
    writeFileSync(file, Buffer.from("oggdata"));
    const seen: { url: string; auth: string; model: string | null; fileName: string | null } = { url: "", auth: "", model: null, fileName: null };
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.url = String(input);
      seen.auth = new Headers(init?.headers).get("authorization") ?? "";
      const form = init?.body as FormData;
      seen.model = form.get("model") as string;
      seen.fileName = (form.get("file") as File).name;
      return new Response(JSON.stringify({ text: "שלום" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const text = await transcribeAudio({ path: file, mimetype: "audio/ogg; codecs=opus", apiKey: "sk-test", fetchImpl });
    expect(text).toBe("שלום");
    expect(seen.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(seen.auth).toBe("Bearer sk-test");
    expect(seen.model).toBe("gpt-4o-mini-transcribe");
    expect(seen.fileName).toBe("note.ogg");
  });

  it("throws on a non-200 answer", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "wat-")), "note.ogg");
    writeFileSync(file, Buffer.from("oggdata"));
    const fetchImpl = (async () => new Response("nope", { status: 401 })) as typeof fetch;
    await expect(transcribeAudio({ path: file, mimetype: "audio/ogg", apiKey: "bad", fetchImpl })).rejects.toThrow(/401/);
  });
});
