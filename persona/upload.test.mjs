import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSkill, syncProfile, makeClient, DEFAULT_PROJECT, DEFAULT_PERSONA } from "./upload.mjs";

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), "fnf-profile-"));
  mkdirSync(join(dir, "instructions"));
  mkdirSync(join(dir, "skills", "fnf-onboarding"), { recursive: true });
  writeFileSync(join(dir, "instructions", "soul.md"), "# Who you are\nYou are F&F.\n");
  writeFileSync(join(dir, "instructions", "chat_format.md"), "# WhatsApp\nShort.\n");
  writeFileSync(join(dir, "skills", "fnf-onboarding", "SKILL.md"), "---\nname: fnf-onboarding\ndescription: First chat with Reef.\n---\n\n# Onboarding\nOne question per message.\n");
  return dir;
}

/** A fake Persona API that remembers what was created. */
function fakeApi() {
  const state = { projects: [], personas: [], instructions: [], skills: [], calls: [] };
  let seq = 0;
  const id = (p) => `${p}_${++seq}`;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ method, path: u.pathname, body, auth: init.headers?.authorization });
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    let m;
    if (method === "GET" && u.pathname === "/api/projects") return json(state.projects);
    if (method === "POST" && u.pathname === "/api/projects") { const p = { id: id("proj"), name: body.name }; const per = { id: id("pers"), name: body.name, projectId: p.id }; state.projects.push(p); state.personas.push(per); return json({ project: p, persona: per }, 201); }
    if ((m = u.pathname.match(/^\/api\/projects\/([^/]+)\/personas$/))) {
      if (method === "GET") return json(state.personas.filter((x) => x.projectId === m[1]));
      const per = { id: id("pers"), name: body.name, projectId: m[1] }; state.personas.push(per); return json(per, 201);
    }
    if ((m = u.pathname.match(/^\/api\/personas\/([^/]+)$/)) && method === "PATCH") { const per = state.personas.find((x) => x.id === m[1]); Object.assign(per, body); return json(per); }
    if ((m = u.pathname.match(/^\/api\/personas\/([^/]+)\/instructions$/))) {
      if (method === "GET") return json(state.instructions.filter((x) => x.personaId === m[1]));
      const ins = { id: id("ins"), personaId: m[1], enabled: true, ...body, content: body.content.trim() }; state.instructions.push(ins); return json(ins, 201);
    }
    if ((m = u.pathname.match(/^\/api\/instructions\/([^/]+)$/)) && method === "PATCH") { const ins = state.instructions.find((x) => x.id === m[1]); Object.assign(ins, body); return json(ins); }
    if ((m = u.pathname.match(/^\/api\/personas\/([^/]+)\/skills$/))) {
      if (method === "GET") return json(state.skills.filter((x) => x.personaId === m[1]).map(({ markdown, ...rest }) => rest));
      const sk = { id: id("sk"), personaId: m[1], enabled: true, origin: "custom", ...body, markdown: body.markdown.trim() }; state.skills.push(sk); return json(sk, 201);
    }
    if ((m = u.pathname.match(/^\/api\/skills\/([^/]+)$/))) {
      const sk = state.skills.find((x) => x.id === m[1]);
      if (method === "GET") return json(sk);
      Object.assign(sk, body); return json(sk);
    }
    return json({ error: `unhandled ${method} ${u.pathname}` }, 404);
  };
  return { state, fetchImpl };
}

test("parseSkill reads name and description from the frontmatter and keeps the whole file as markdown", () => {
  const s = parseSkill("---\nname: research\ndescription: Look things up.\n---\n\n# Research\nbody\n");
  assert.deepEqual({ name: s.name, description: s.description }, { name: "research", description: "Look things up." });
  assert.match(s.markdown, /^---\nname: research/);
  assert.throws(() => parseSkill("# no frontmatter"), /description/);
});

test("first sync creates the project, persona, instructions and skills; second sync updates in place", async () => {
  const dir = fixtureDir();
  const { state, fetchImpl } = fakeApi();
  const client = makeClient({ base: "https://persona-goldy.vercel.app/api", key: "persona_sk_test", fetchImpl });
  const first = await syncProfile(client, { dir, projectName: "F&F", personaName: "F&F", model: "anthropic/claude-fable-5-1" });
  assert.equal(state.projects.length, 1);
  assert.equal(state.personas.length, 1, "the project's first persona is reused, not duplicated");
  assert.equal(state.personas[0].model, "anthropic/claude-fable-5-1");
  assert.deepEqual(state.instructions.map((i) => i.name).sort(), ["chat_format", "soul"]);
  assert.deepEqual(state.skills.map((s) => s.name), ["fnf-onboarding"]);
  assert.equal(state.skills[0].description, "First chat with Reef.");
  assert.deepEqual(first.created.sort(), ["instruction:chat_format", "instruction:soul", "persona:F&F", "project:F&F", "skill:fnf-onboarding"].sort());
  assert.ok(state.calls.every((c) => c.auth === "Bearer persona_sk_test"));

  writeFileSync(join(dir, "instructions", "soul.md"), "# Who you are\nYou are F&F, v2.\n");
  const second = await syncProfile(client, { dir, projectName: "F&F", personaName: "F&F" });
  assert.equal(state.projects.length, 1);
  assert.equal(state.personas.length, 1);
  assert.equal(state.instructions.length, 2);
  assert.equal(state.skills.length, 1);
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.updated, ["instruction:soul"]);
  assert.deepEqual(second.unchanged.sort(), ["instruction:chat_format", "skill:fnf-onboarding"]);
  assert.equal(state.instructions.find((i) => i.name === "soul").content, "# Who you are\nYou are F&F, v2.\n");
});

test("a new project's first persona is renamed to the persona name, not left behind as a stray", async () => {
  const dir = fixtureDir();
  const { state, fetchImpl } = fakeApi();
  const client = makeClient({ base: "https://persona-goldy.vercel.app/api", key: "persona_sk_test", fetchImpl });
  const out = await syncProfile(client, { dir, projectName: DEFAULT_PROJECT, personaName: DEFAULT_PERSONA });
  assert.equal(state.personas.length, 1, "no extra persona named after the project");
  assert.equal(state.personas[0].name, "F&F template");
  assert.equal(out.personaId, state.personas[0].id);
  assert.ok(out.created.includes("persona:F&F template"));
});

test("an API error surfaces the status and body", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: "nope" }), { status: 401 });
  const client = makeClient({ base: "https://x.test/api", key: "k", fetchImpl });
  await assert.rejects(client.request("GET", "/projects"), /401.*nope/);
});

test("extractSaid collects chat_say texts from actions.requested events and reports when the turn is over", async () => {
  const { extractSaid } = await import("./upload.mjs");
  const events = [
    { type: "message.received", data: { message: "hi" } },
    { type: "action.input.appended", data: { toolName: "chat_say", inputTextDelta: "{\"text\": \"par" } },
    { type: "actions.requested", data: { actions: [{ kind: "load-skill", name: "fnf-onboarding" }] } },
    { type: "actions.requested", data: { actions: [{ kind: "tool-call", toolName: "chat_say", input: { text: "היי, אני F&F." } }] } },
    { type: "action.result", data: { result: { toolName: "chat_say", output: { sent: true } } } },
    { type: "step.finished", data: { finishReason: "stop" } },
  ];
  const out = extractSaid(events);
  assert.deepEqual(out.said, ["היי, אני F&F."]);
  assert.equal(out.done, true);
  assert.equal(extractSaid(events.slice(0, 4)).done, false);
});

test("the default model for every F&F persona is Gemini 4 Argon, and the CLI applies it when --model is absent", async () => {
  const { DEFAULT_MODEL, modelArg } = await import("./upload.mjs");
  assert.equal(DEFAULT_MODEL, "google/gemini-4-argon");
  assert.equal(modelArg([]), "google/gemini-4-argon");
  assert.equal(modelArg(["--model", "anthropic/claude-fable-5.1"]), "anthropic/claude-fable-5.1");
});
