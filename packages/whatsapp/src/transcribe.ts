/** Voice notes become text through OpenAI's transcription endpoint. */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export const TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
export const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

export interface TranscribeOptions {
  path: string;
  mimetype: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  model?: string;
}

export async function transcribeAudio(opts: TranscribeOptions): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const form = new FormData();
  const type = opts.mimetype.split(";")[0]?.trim() || "application/octet-stream";
  form.append("file", new File([readFileSync(opts.path)], basename(opts.path), { type }));
  form.append("model", opts.model ?? DEFAULT_TRANSCRIPTION_MODEL);
  const res = await fetchImpl(TRANSCRIPTION_URL, { method: "POST", headers: { authorization: `Bearer ${opts.apiKey}` }, body: form });
  if (!res.ok) throw new Error(`transcription failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { text?: string };
  return (body.text ?? "").trim();
}
