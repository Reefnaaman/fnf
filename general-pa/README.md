# General PA on Persona

A reusable personal-assistant template for the Persona platform, built on the F&F profile next
to it (`../persona`). It aims at what makes Instinct feel easy: it wakes, judges, usually stays
silent, and when it speaks it offers something a one-word yes settles. On hosted Persona the
hard part is delivery, not intelligence, so the build starts there.

```
instructions/*.md          always-on rules, one instruction per file (7)
skills/<name>/SKILL.md     skills loaded on demand (12)
automations/<name>.md      automation definitions: frontmatter name, cron, timezone; body = prompt
upload.mjs                 idempotent sync, renders automations into the skills, chat smoke test
upload.test.mjs            node --test upload.test.mjs
```

## Upload

```bash
cd general-pa
PERSONA_API_KEY=persona_sk_... node upload.mjs
```

It creates or updates the persona `General PA template` in the project `General PA` (pass
`--project` and `--persona` for another), pins `google/gemini-4-argon` unless `--model` is given,
and matches every instruction and skill by name, so a second run changes nothing. `--only a,b`
pushes just those items to an existing persona. `--chat "היי"` sends one message through the
agent API and prints the session id; `--chat "..." --session <id>` continues that conversation.

Automations are not uploaded. A template automation has no chat to deliver to, and one made inside
a run reaches nobody, so the persona creates each one in the owner's chat during onboarding. The
upload renders `{{automation:<name>}}` in a skill into the exact `automation_create` values from
`automations/<name>.md`, which keeps the definitions in one place.

## Design: each piece and the build order

Working state lives in five notes, because automation and trigger runs do not recall memory on
their own. Formats are in `skills/pa-notes`.

| Build order | Piece | Files |
|---|---|---|
| P0-1 delivery health | The owner's next message is the delivery and scheduling moment. Every proactive run writes what it sent or held to `pa:outbox`. Runs that would land in a closed window (owner silent more than 23 h, from the stamp in `pa:proactive-log`) hold instead of sending, which also saves the relay turn. On the owner's next message, `catch_up_on_return` re-checks held and probably-dropped items and sends one "while you were away" message with only what is still true. The brief ends with at most one real decision so the answer reopens the window. Runs never create automations: they write `schedule:` lines, and the main agent offers or creates them in chat. Mail HOLD and FOLLOWUP now go to `pa:outbox` and `pa:open-loops` instead of one-off automations. | `instructions/catch_up_on_return.md`, `instructions/house_rules.md`, `skills/daily-brief`, `skills/mail-watch` |
| P0-2 one speaking rubric | `proactive_rules`: new since the last report, still true at send time, and in a listed category. Lead with the information, one-clause reason, a "Checked:" data line, money/time/people as an offer. Max 3 unscheduled messages a day, quiet hours 23:00-07:30 go to held, never repeat a seen item. Back-off ladder in `pa:proactive-log`: 5 unanswered briefs, Sundays only; 3 unanswered Sundays, paused and asked once on the next owner message. | `instructions/proactive_rules.md`, `skills/pa-notes` |
| P0-3 open loops | `pa:open-loops` ledger (what, who acts next, due, next check, source, status), written only by the main agent in chat. The brief nudges after the check date, every 3 days, at most 3 times, then asks once to drop it. Five open check-ins at most. | `skills/open-loops`, `skills/daily-brief` |
| P1 look-ahead | 17:00 Sunday to Thursday, usually silent; leave-by times from OSRM with a margin, offered as a reminder the owner settles with a yes. Onboarding records `trigger_types({app:'googlecalendar'})` once and creates no calendar trigger. | `skills/look-ahead`, `automations/look-ahead.md` |
| P1 watch | "Keep an eye on X": one cron automation per watch, every 8 h by default, never under 1 h (3 h for booking sites), 14-day expiry, alert only unless the owner named the item and a ceiling inside ₪200, curl before the browser, three active at most, paused (not deleted) after a hit or expiry. | `skills/watch` |
| P1 profile and corrections | `pa:profile` with Life context, Autonomy calibration, Channel style, Owner's rules (one sentence, scope, date, source, 90-day review). `learn_from_corrections` asks "remember as a rule? (yes / just this time)". A nightly tidy that never sends trims notes and queues reviews. "What do you know about me", "forget that" and "off the record" are in `about-me`. | `instructions/learn_from_corrections.md`, `skills/about-me`, `automations/memory-tidy.md` |
| P2 autonomy ramp | Only on the owner's own words, written with its limit under Autonomy calibration. | `instructions/learn_from_corrections.md`, `skills/pa-onboarding` |
| P2 Gmail first look | Offered once after Gmail connects; on a yes, at most ten summary lines, no bodies. | `skills/pa-onboarding` |
| P2 weekly ledger | Friday note of quiet work, offered once by the brief after the first week, created in chat on a yes. | `skills/weekly-ledger`, `automations/weekly-ledger.md` |
| P2 subscription sweep | Design only, not built: a monthly run that reads receipts in mail and lists recurring charges as open loops. Waits until mail runs can be measured for cost. | none |

Kept out on purpose (Instinct behaviours not copied): data kept after disconnect (the agent says
what remains and offers to forget), mail sent without the full body shown and a yes, instructions
obeyed from inside email (trigger runs are read-only and write no notes), passwords or card numbers
in chat (vault collect links only), purchases not tied to a stated need, a watch or an open loop,
hammering booking sites, and any cap on the owner's own chat. Every proactive message names what
was checked, and nothing claims work that did not run.

From F&F: `chat_format`, `mail_watch_on_connect`, `mail-and-calendar`, `errands` and `research`
are carried over with the owner made generic and the rules above added. `whatsapp-etiquette` is
dropped because `chat_format` already holds the same rules. Nothing in `../persona` changed.

## Tested on hosted Persona, 2026-11-04

Uploaded to a new test project and exercised through the agent API (web channel), as a made-up
owner, about 15 chat turns plus 5 one-off runs.

Verified:
- Upload is idempotent: a second run reports every instruction and skill unchanged.
- Onboarding in Hebrew, one question per turn, creates the five notes and, on yeses, the Daily
  brief, Look-ahead and Memory tidy automations with the exact rendered values.
- Automation runs read and write notes: a brief run wrote its `pa:outbox` line and raised
  `unseen`; a fixture run replaced two notes.
- The brief's data line names only what it checked (weather and open loops, with no calendar or
  mail connected).
- Catch-up: with the notes set to two days of silence, "היי, מה קורה?" got one "בזמן שלא היית כאן"
  message. The expired package was dropped, two lines about the same loop were merged, and the
  queued `schedule:` reminder was offered. Notes were marked seen, the stamp moved, counters reset.
  The "כן" that followed created the reminder from chat, with a prompt that re-checks the loop.
- Corrections: "don't use long dashes" was applied and got "לזכור את זה ככלל? (כן / רק הפעם)";
  the yes added R1 with a 90-day review.
- Open loop added from "I need to pay my friend back 200 by Thursday", resolved as tomorrow.
- "מה אתה יודע עליי" listed the profile, the rule and the counts.
- Watch: current value checked first, 8 h cadence, expiry 14 days out, `pa:watches` line.
- Off the record: no notes and no memory call, with an honest line about platform memory.
- Look-ahead and nightly tidy runs both stayed silent (`notify: false`) with correct reasons.
- `trigger_types({app:'googlecalendar'})` lists 7 triggers, including
  `GOOGLECALENDAR_EVENT_STARTING_SOON_TRIGGER`. Not used yet: each event would fire a paid run,
  where the look-ahead is one run per workday.

Not tested:
- WhatsApp delivery of anything. The test chat is the web channel, so automations created there
  have no link. Whether automations created in a WhatsApp onboarding carry the link (expected from
  F&F) and whether held items really reach the owner after a closed window.
- The relay turn on WhatsApp ("your automation just ran") and the 3-a-day cap under real mail.
- Mail watch, Gmail first look and calendar reads: no mailbox or calendar was connected.
- The back-off ladder over real days, the Sunday-only mode and the paused ask.
- The watch run itself on its schedule, and a pre-approved buy.
- Whether "forget that" removes the memory (the memory tool's forget call was not exercised).

Open questions:
- How often owners answer the brief on WhatsApp. That rate decides whether the window stays open
  and whether the ladder ever fires. Only the inbound `lastMessageAt` on links can measure it.
- The per-owner cost of a quiet day. Estimated from the token counts the test sessions recorded,
  at the gateway list price for gemini-4-argon ($2 in, $0.10 cached in, $10 out per million): a
  chat turn cost $0.06 to $0.17 (rising as the session grows), a brief run $0.13, a look-ahead run
  $0.13, a tidy run $0.09. A quiet day with no mail is then about $0.45 (brief + its relay turn +
  look-ahead + tidy), before mail trigger runs (one per email, most `[SILENT]`) and watch runs
  (about $0.10 each, 3 a day per watch). `mail_watch_on_connect` also checks connections on every
  turn until a mailbox has a trigger. What Persona actually bills is unknown: the credit rate is
  only in the console, and `/api/projects/{id}/usage` answered 404 on 2026-11-04.

## Connect a number

As in F&F: make a link code on the persona's Channels tab, send `link <code>` from the owner's
phone, say hi. Onboarding runs and creates the brief, the look-ahead and the tidy from that chat,
so they carry its link. Each owner gets their own copy of the persona: memory is shared by
everyone who talks to one persona.
