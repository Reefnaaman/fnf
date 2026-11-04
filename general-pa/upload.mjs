#!/usr/bin/env node
/**
 * Sync the General PA template in this folder to a Persona persona: project, persona, model,
 * instructions (one per instructions/*.md) and skills (one per skills/<name>/SKILL.md).
 * Automations are not uploaded: each automations/<name>.md is rendered into the skills that
 * mention {{automation:<name>}}, and the persona creates them from the owner's chat, so they
 * carry the chat's delivery link. Idempotent: rows are matched by name and updated in place.
 *
 *   PERSONA_API_KEY=persona_sk_... node upload.mjs [--project "General PA"] [--persona "General PA template"] [--model <gateway id>] [--only name,name] [--chat "hi" [--session <id>]]
 *
 * --chat sends one message through the agent API and prints what the persona said; --session
 * continues that conversation (the session id is printed by the previous --chat).
 *
 * PERSONA_API_BASE defaults to https://persona-goldy.vercel.app/api. The key is read from the
 * environment only and never written anywhere.
 */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_BASE, makeClient, modelArg, readProfile, syncProfile } from "../persona/upload.mjs";

export const DEFAULT_PROJECT = "General PA";
export const DEFAULT_PERSONA = "General PA template";

/** name, cron, timezone and the prompt (the body) of one automations/<name>.md. */
export function parseAutomation(markdown, file = "automation") {
  const m = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: needs frontmatter with name, cron and timezone`);
  const fields = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  const prompt = m[2].trim();
  for (const key of ["name", "cron", "timezone"]) if (!fields[key]) throw new Error(`${file}: frontmatter needs ${key}`);
  if (fields.cron.split(/\s+/).length !== 5) throw new Error(`${file}: cron must have 5 fields`);
  if (!prompt) throw new Error(`${file}: the body is the automation prompt and cannot be empty`);
  return { name: fields.name, cron: fields.cron, timezone: fields.timezone, prompt };
}

export function readAutomations(dir) {
  const out = {};
  for (const f of readdirSync(join(dir, "automations")).filter((f) => f.endsWith(".md")).sort()) {
    out[basename(f, ".md")] = parseAutomation(readFileSync(join(dir, "automations", f), "utf8"), f);
  }
  return out;
}

/** The block the persona reads in a skill: the exact automation_create arguments. */
export function automationBlock(a) {
  return [
    `automation_create with exactly these values (change only the cron, to the time the owner chose):`,
    `- name: ${a.name}`,
    `- cron: ${a.cron}`,
    `- timezone: ${a.timezone}`,
    `- prompt: ${a.prompt}`,
  ].join("\n");
}

/** Replace every {{automation:<name>}} in a skill; an unknown name is an error, not a silent gap. */
export function renderAutomations(markdown, automations) {
  return markdown.replace(/\{\{automation:([a-z0-9-]+)\}\}/g, (_, name) => {
    if (!automations[name]) throw new Error(`skill mentions {{automation:${name}}} but automations/${name}.md does not exist`);
    return automationBlock(automations[name]);
  });
}

/**
 * The profile as the API should store it: a temporary folder with the same instructions and the
 * skills rendered, so the F&F sync can push it unchanged.
 */
export function renderProfileDir(dir) {
  const automations = readAutomations(dir);
  const { instructions, skills } = readProfile(dir);
  const out = mkdtempSync(join(tmpdir(), "general-pa-"));
  mkdirSync(join(out, "instructions"));
  mkdirSync(join(out, "skills"));
  for (const ins of instructions) writeFileSync(join(out, "instructions", `${ins.name}.md`), ins.content);
  for (const sk of skills) {
    mkdirSync(join(out, "skills", sk.name));
    writeFileSync(join(out, "skills", sk.name, "SKILL.md"), renderAutomations(sk.markdown, automations));
  }
  return out;
}

/**
 * What the persona said in the turn that answered `message`: chat_say texts in order, the tools it
 * called, and whether that turn settled. The stream replays the whole session, so the turn starts
 * at the fact for its delivery id, or else at the last fact that carries the message text.
 */
export function readTurn(lines, message, deliveryId) {
  const facts = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    for (const f of Array.isArray(parsed?.facts) ? parsed.facts : [parsed]) facts.push(f);
  }
  let start = -1;
  const needle = JSON.stringify(message).slice(1, -1);
  facts.forEach((f, i) => {
    const type = f?.type ?? "";
    // The delivery id names this exact message; without one, the last fact that carries its text
    if (deliveryId ? type === "delivery.consumed" && f.data?.deliveryId === deliveryId : /^(message\.|turn\.|delivery\.consumed)/.test(type) && JSON.stringify(f.data ?? {}).includes(needle)) start = i;
  });
  const said = [];
  const tools = [];
  let settled = false;
  if (start < 0) return { said, tools, settled };
  for (const f of facts.slice(start)) {
    const type = f?.type ?? "";
    const calls = type === "actions.requested" ? (f.data?.actions ?? []) : type === "call.requested" ? [f.data ?? {}] : [];
    for (const c of calls) {
      const name = c.toolName ?? c.capability?.name ?? c.name;
      if (name) tools.push(name);
      if (name === "chat_say" && c.input?.text) said.push(c.input.text);
    }
    if (type === "turn.settled" || /^turn\.(completed|finished|ended)$/.test(type)) settled = true;
  }
  return { said, tools, settled };
}

/** One message through the agent API, new session or an existing one; reads the stream again until that turn settles. */
export async function chat(client, personaId, message, { sessionId, fetchImpl = globalThis.fetch, timeoutMs = 300_000, onLines } = {}) {
  const { token } = await client.request("POST", `/personas/${personaId}/agent-token`);
  const eve = client.root.replace(/\/api$/, "") + "/eve/v1";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const url = sessionId ? `${eve}/session/${sessionId}` : `${eve}/session`;
  const started = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify({ message }) });
  if (!started.ok) throw new Error(`eve session -> HTTP ${started.status}: ${(await started.text()).slice(0, 300)}`);
  const body = await started.json().catch(() => ({}));
  const id = sessionId ?? body.sessionId;
  const deliveryId = body.deliveryId ?? body.delivery?.id;
  const deadline = Date.now() + timeoutMs;
  let turn = { said: [], tools: [], settled: false };
  // The stream drops after about a minute while the agent keeps working; reconnecting replays everything
  while (!turn.settled && Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    const lines = [];
    try {
      const res = await fetchImpl(`${eve}/session/${id}/stream`, { headers, signal: controller.signal });
      let buffer = "";
      for await (const chunk of res.body) {
        buffer += Buffer.from(chunk).toString("utf8");
        const parts = buffer.split("\n");
        buffer = parts.pop();
        lines.push(...parts);
        turn = readTurn(lines, message, deliveryId);
        if (turn.settled) break;
      }
      if (buffer) lines.push(buffer);
      turn = readTurn(lines, message, deliveryId);
    } catch (err) {
      if (err?.name !== "AbortError") throw err;
    } finally {
      clearTimeout(timer);
      controller.abort();
      onLines?.(lines);
    }
  }
  return { sessionId: id, deliveryId, ...turn };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const client = makeClient({ base: process.env.PERSONA_API_BASE ?? DEFAULT_BASE, key: process.env.PERSONA_API_KEY });
  const rendered = renderProfileDir(fileURLToPath(new URL(".", import.meta.url)));
  try {
    const out = await syncProfile(client, {
      dir: rendered,
      projectName: arg("--project") ?? DEFAULT_PROJECT,
      personaName: arg("--persona") ?? DEFAULT_PERSONA,
      model: modelArg(process.argv.slice(2)),
      only: arg("--only")?.split(",").map((s) => s.trim()).filter(Boolean),
    });
    console.log(JSON.stringify(out, null, 2));
    const msg = arg("--chat");
    if (msg) console.log(JSON.stringify(await chat(client, out.personaId, msg, { sessionId: arg("--session") }), null, 2));
  } finally {
    rmSync(rendered, { recursive: true, force: true });
  }
}
