#!/usr/bin/env node
/**
 * Sync the F&F profile in this folder to a Persona persona: project, persona, model,
 * instructions (one per instructions/*.md, named after the file) and skills (one per
 * skills/<name>/SKILL.md). Idempotent: existing rows are updated in place by name.
 *
 *   PERSONA_API_KEY=persona_sk_... node upload.mjs [--project "F&F"] [--persona "F&F"] [--model <gateway id>] [--chat "hi"]
 *
 * PERSONA_API_BASE defaults to https://persona-goldy.vercel.app/api. The key is read from the
 * environment only and never written anywhere.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BASE = "https://persona-goldy.vercel.app/api";

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
    // A new project comes with a first persona named after it.
    if (made.persona && made.persona.name === personaName) {
      persona = made.persona;
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
    } else if (have.content !== ins.content) {
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
    if (full.markdown !== sk.markdown || full.description !== sk.description) {
      await client.request("PATCH", `/skills/${have.id}`, { description: sk.description, markdown: sk.markdown });
      result.updated.push(`skill:${sk.name}`);
    } else {
      result.unchanged.push(`skill:${sk.name}`);
    }
  }
  return { projectId: project.id, personaId: persona.id, ...result };
}

/** One message through the agent API; prints what the persona says. */
export async function smokeChat(client, personaId, message, { fetchImpl = globalThis.fetch, timeoutMs = 120_000 } = {}) {
  const { token } = await client.request("POST", `/personas/${personaId}/agent-token`);
  const eve = client.root.replace(/\/api$/, "") + "/eve/v1";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const started = await fetchImpl(`${eve}/session`, { method: "POST", headers, body: JSON.stringify({ message }) });
  if (!started.ok) throw new Error(`eve session -> HTTP ${started.status}: ${(await started.text()).slice(0, 300)}`);
  const { sessionId } = await started.json();
  const res = await fetchImpl(`${eve}/session/${sessionId}/stream`, { headers, signal: AbortSignal.timeout(timeoutMs) });
  const said = [];
  for await (const chunk of res.body) {
    for (const line of Buffer.from(chunk).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      const text = ev?.action?.name === "chat_say" ? ev.action?.input?.text ?? ev.action?.args?.text : ev?.type === "chat_say" ? ev.text : undefined;
      if (text) said.push(text);
      if (ev?.type === "done" || ev?.status === "done" || ev?.status === "completed") break;
    }
  }
  return { sessionId, said };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const client = makeClient({ base: process.env.PERSONA_API_BASE ?? DEFAULT_BASE, key: process.env.PERSONA_API_KEY });
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const out = await syncProfile(client, { dir, projectName: arg("--project") ?? "F&F", personaName: arg("--persona") ?? "F&F", model: arg("--model") });
  console.log(JSON.stringify(out, null, 2));
  const msg = arg("--chat");
  if (msg) {
    const chat = await smokeChat(client, out.personaId, msg);
    console.log(JSON.stringify(chat, null, 2));
  }
}
