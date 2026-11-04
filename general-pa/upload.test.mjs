import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { automationBlock, parseAutomation, readAutomations, readTurn, renderAutomations, renderProfileDir } from "./upload.mjs";
import { readProfile } from "../persona/upload.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

test("parseAutomation reads name, cron and timezone from the frontmatter and the body as the prompt", () => {
  const a = parseAutomation("---\nname: Look-ahead\ncron: 0 17 * * 0-4\ntimezone: Asia/Jerusalem\n---\nRun the look-ahead skill.\n");
  assert.deepEqual(a, { name: "Look-ahead", cron: "0 17 * * 0-4", timezone: "Asia/Jerusalem", prompt: "Run the look-ahead skill." });
  assert.throws(() => parseAutomation("no frontmatter"), /frontmatter/);
  assert.throws(() => parseAutomation("---\nname: X\ncron: 0 17 * *\ntimezone: Asia/Jerusalem\n---\nbody\n"), /5 fields/);
  assert.throws(() => parseAutomation("---\nname: X\ncron: 0 17 * * *\ntimezone: Asia/Jerusalem\n---\n\n"), /cannot be empty/);
});

test("renderAutomations puts the exact automation_create values in place and refuses an unknown name", () => {
  const automations = { "look-ahead": { name: "Look-ahead", cron: "0 17 * * 0-4", timezone: "Asia/Jerusalem", prompt: "Run it." } };
  const out = renderAutomations("Before\n\n{{automation:look-ahead}}\n\nAfter", automations);
  assert.equal(out, `Before\n\n${automationBlock(automations["look-ahead"])}\n\nAfter`);
  assert.match(out, /- cron: 0 17 \* \* 0-4/);
  assert.throws(() => renderAutomations("{{automation:nope}}", automations), /automations\/nope\.md does not exist/);
});

test("the real template renders: every placeholder resolves and every automation file is used by a skill", () => {
  const automations = readAutomations(here);
  assert.deepEqual(Object.keys(automations).sort(), ["daily-brief", "look-ahead", "memory-tidy", "weekly-ledger"]);
  const dir = renderProfileDir(here);
  try {
    const { instructions, skills } = readProfile(dir);
    assert.deepEqual(instructions.map((i) => i.name).sort(), ["catch_up_on_return", "chat_format", "house_rules", "learn_from_corrections", "mail_watch_on_connect", "proactive_rules", "soul"]);
    for (const sk of skills) assert.doesNotMatch(sk.markdown, /\{\{automation:/, `${sk.name} still has a placeholder`);
    const all = skills.map((s) => s.markdown).join("\n");
    for (const a of Object.values(automations)) assert.ok(all.includes(`- name: ${a.name}`), `${a.name} is not offered by any skill`);
    assert.equal(skills.length, readdirSync(join(here, "skills")).length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the template names no real person: the owner is always 'the owner'", () => {
  const files = [
    ...readdirSync(join(here, "instructions")).map((f) => join(here, "instructions", f)),
    ...readdirSync(join(here, "skills")).map((d) => join(here, "skills", d, "SKILL.md")),
    ...readdirSync(join(here, "automations")).map((f) => join(here, "automations", f)),
  ];
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8"), /Reef|ריף/, f);
});

test("readTurn takes the turn that answers the message, not an earlier one replayed by the stream", () => {
  const lines = [
    JSON.stringify({ type: "message.received", data: { message: "היי" } }),
    JSON.stringify({ type: "call.requested", data: { name: "chat_say", input: { text: "old answer" } } }),
    JSON.stringify({ type: "turn.settled", data: {} }),
    JSON.stringify({ facts: [{ type: "delivery.consumed", data: { parts: [{ kind: "text", text: "מה יש מחר?" }] } }] }),
    JSON.stringify({ facts: [{ type: "call.requested", data: { capability: { kind: "tool", name: "chat_react" }, input: { emoji: "👍" } } }] }),
    JSON.stringify({ type: "actions.requested", data: { actions: [{ toolName: "note_read", input: {} }, { toolName: "chat_say", input: { text: "מחר שקט." } }] } }),
  ];
  assert.deepEqual(readTurn(lines, "מה יש מחר?"), { said: ["מחר שקט."], tools: ["chat_react", "note_read", "chat_say"], settled: false });
  assert.equal(readTurn([...lines, JSON.stringify({ type: "turn.settled" })], "מה יש מחר?").settled, true);
  assert.deepEqual(readTurn(lines.slice(0, 3), "מה יש מחר?"), { said: [], tools: [], settled: false });
  const again = [
    JSON.stringify({ facts: [{ type: "delivery.consumed", data: { deliveryId: "d1", parts: [{ kind: "text", text: "כן" }] } }] }),
    JSON.stringify({ type: "turn.settled" }),
  ];
  assert.equal(readTurn(again, "כן", "d2").settled, false, "an earlier identical message is not this delivery");
  assert.equal(readTurn(again, "כן", "d1").settled, true);
});
