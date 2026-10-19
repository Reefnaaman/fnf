#!/usr/bin/env node
/**
 * Sync the F&F profile in this folder to a Persona persona: project, persona, model,
 * instructions (one per instructions/*.md, named after the file) and skills (one per
 * skills/<name>/SKILL.md). Idempotent: existing rows are updated in place by name.
 *
 *   PERSONA_API_KEY=persona_sk_... node upload.mjs [--project "F&F"] [--persona "F&F template"] [--model <gateway id>] [--chat "hi"]
 *
 * Without --model the persona is pinned to google/gemini-4-argon, the model every persona in the F&F project uses.
 *
 * PERSONA_API_BASE defaults to https://persona-goldy.vercel.app/api. The key is read from the
 * environment only and never written anywhere.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE = "https://persona-goldy.vercel.app/api";
export const DEFAULT_PROJECT = "F&F";
export const DEFAULT_PERSONA = "F&F template";
/** Reef keeps every persona in the F&F project on this model. Pass --model only to deviate on purpose. */
export const DEFAULT_MODEL = "google/gemini-4-argon";

/** The model the CLI applies: --model when given, else the project default. */
export function modelArg(argv) {
  const i = argv.indexOf("--model");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : DEFAULT_MODEL;
}

export function makeClient({ base = DEFAULT_BASE, key, fetchImpl = globalThis.fetch }) {
  if (!key) throw new Error("PERSONA_API_KEY is required");
  const root = base.replace(/\/+$/, "");
  async function request(method, path, body) {
    const res = await fetchImpl(`${root}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : undefined;
  }
  return { request, root };
}

/** name and description from the SKILL.md frontmatter; the whole file is the markdown. */
export function parseSkill(markdown) {
  const m = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error("SKILL.md needs frontmatter with name and description");
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, "$1");
  }
  if (!fields.name || !fields.description) throw new Error("SKILL.md frontmatter needs name and description");
  return { name: fields.name, description: fields.description, markdown };
}

export function readProfile(dir) {
  const instructions = readdirSync(join(dir, "instructions"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => ({ name: basename(f, ".md"), content: readFileSync(join(dir, "instructions", f), "utf8") }));
  const skills = readdirSync(join(dir, "skills"))
    .filter((d) => statSync(join(dir, "skills", d)).isDirectory())
    .sort()
    .map((d) => parseSkill(readFileSync(join(dir, "skills", d, "SKILL.md"), "utf8")));
  return { instructions, skills };
}

/** The API stores text trimmed; compare the way it stores. */
const same = (a, b) => (a ?? "").trim() === (b ?? "").trim();

export async function syncProfile(client, { dir, projectName, personaName, model }) {
  const result = { created: [], updated: [], unchanged: [] };
  const { instructions, skills } = readProfile(dir);

  const projects = await client.request("GET", "/projects");
  let project = projects.find((p) => p.name === projectName);
  let persona;
  if (!project) {
    const made = await client.request("POST", "/projects", { name: projectName });
    project = made.project;
    result.created.push(`project:${projectName}`);
    // A new project comes with a first persona named after the project. Use it as this
    // persona, renamed when the names differ, so no stray persona is left behind.
    if (made.persona) {
      persona = made.persona.name === personaName
        ? made.persona
        : await client.request("PATCH", `/personas/${made.persona.id}`, { name: personaName });
      result.created.push(`persona:${personaName}`);
    }
  }
  if (!persona) {
    const personas = await client.request("GET", `/projects/${project.id}/personas`);
    persona = personas.find((p) => p.name === personaName);
    if (!persona) {
      persona = await client.request("POST", `/projects/${project.id}/personas`, { name: personaName });
      result.created.push(`persona:${personaName}`);
    }
  }
  if (model && persona.model !== model) {
    await client.request("PATCH", `/personas/${persona.id}`, { model });
    result.updated.push(`persona:model`);
  }

  const existingInstructions = await client.request("GET", `/personas/${persona.id}/instructions`);
  for (const ins of instructions) {
    const have = existingInstructions.find((x) => x.name === ins.name);
    if (!have) {
      await client.request("POST", `/personas/${persona.id}/instructions`, { name: ins.name, content: ins.content, enabled: true });
      result.created.push(`instruction:${ins.name}`);
    } else if (same(have.content, ins.content) === false) {
      await client.request("PATCH", `/instructions/${have.id}`, { content: ins.content });
      result.updated.push(`instruction:${ins.name}`);
    } else {
      result.unchanged.push(`instruction:${ins.name}`);
    }
  }

  const existingSkills = await client.request("GET", `/personas/${persona.id}/skills`);
  for (const sk of skills) {
    const have = existingSkills.find((x) => x.name === sk.name);
    if (!have) {
      await client.request("POST", `/personas/${persona.id}/skills`, { name: sk.name, description: sk.description, markdown: sk.markdown, enabled: true });
      result.created.push(`skill:${sk.name}`);
      continue;
    }
    const full = await client.request("GET", `/skills/${have.id}`);
    if (!same(full.markdown, sk.markdown) || !same(full.description, sk.description)) {
      await client.request("PATCH", `/skills/${have.id}`, { description: sk.description, markdown: sk.markdown });
      result.updated.push(`skill:${sk.name}`);
    } else {
      result.unchanged.push(`skill:${sk.name}`);
    }
  }
  return { projectId: project.id, personaId: persona.id, ...result };
}

/**
 * What the persona said, from eve stream events: every chat_say tool call, and whether the
 * turn finished (a step that ended with finishReason "stop", or a turn.* completion event).
 */
export function extractSaid(events) {
  const said = [];
  let done = false;
  for (const ev of events) {
    const type = ev?.type ?? "";
    if (type === "actions.requested") {
      for (const a of ev.data?.actions ?? []) if (a.toolName === "chat_say" && a.input?.text) said.push(a.input.text);
    }
    if (type === "step.finished" && ev.data?.finishReason === "stop") done = true;
    if (/^turn\.(completed|finished|ended)$/.test(type)) done = true;
  }
  return { said, done };
}

/** One message through the agent API; returns what the persona said in that turn. */
export async function smokeChat(client, personaId, message, { fetchImpl = globalThis.fetch, timeoutMs = 120_000 } = {}) {
  const { token } = await client.request("POST", `/personas/${personaId}/agent-token`);
  const eve = client.root.replace(/\/api$/, "") + "/eve/v1";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const started = await fetchImpl(`${eve}/session`, { method: "POST", headers, body: JSON.stringify({ message }) });
  if (!started.ok) throw new Error(`eve session -> HTTP ${started.status}: ${(await started.text()).slice(0, 300)}`);
  const { sessionId } = await started.json();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetchImpl(`${eve}/session/${sessionId}/stream`, { headers, signal: controller.signal });
  const events = [];
  let out = { said: [], done: false };
  try {
    for await (const chunk of res.body) {
      for (const line of Buffer.from(chunk).toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { continue; }
      }
      out = extractSaid(events);
      if (out.done) break;
    }
  } catch (err) {
    if (err?.name !== "AbortError") throw err;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { sessionId, said: out.said, done: out.done };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const client = makeClient({ base: process.env.PERSONA_API_BASE ?? DEFAULT_BASE, key: process.env.PERSONA_API_KEY });
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const out = await syncProfile(client, { dir, projectName: arg("--project") ?? DEFAULT_PROJECT, personaName: arg("--persona") ?? DEFAULT_PERSONA, model: modelArg(process.argv.slice(2)) });
  console.log(JSON.stringify(out, null, 2));
  const msg = arg("--chat");
  if (msg) {
    const chat = await smokeChat(client, out.personaId, msg);
    console.log(JSON.stringify(chat, null, 2));
  }
}
