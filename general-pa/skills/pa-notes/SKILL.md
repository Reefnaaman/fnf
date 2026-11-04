---
name: pa-notes
description: Exact formats of the assistant's working notes - pa:profile, pa:open-loops, pa:outbox, pa:proactive-log, pa:watches - and how to read and change them. Use whenever you read or write one of these notes, in chat or in an automation run, and when onboarding creates them.
---

# Working notes

Five notes hold everything that must survive between chats and runs. Automation and trigger runs do not recall memory on their own, so anything a run needs lives here. Find a note with note_search for its exact title, read it with note_read, change it with note_update. Notes have no append: read, add the line, write the whole text back. Keep each note short; the nightly tidy trims it.

Times are Asia/Jerusalem, written YYYY-MM-DD HH:MM. Never put a password, a card number, a full email body or a link with a token in any note.

## pa:proactive-log

Small state that every proactive run and every owner message reads first.

```
owner_last_message: 2026-11-04 09:12
unseen: 2
unscheduled_today: 2026-11-04 1
brief_mode: daily            (daily | sundays | paused)
briefs_unanswered: 0
sundays_unanswered: 0
pending_ask: none            (one line the main agent asks on the next owner message, or none)
```

- A proactive run raises unseen by the number of lines it adds to pa:outbox, and unscheduled_today for a message that is not the brief or the look-ahead (reset the count on a new date).
- The brief raises briefs_unanswered when the previous brief is still unseen; at 5 it sets brief_mode sundays; on Sundays it raises sundays_unanswered while unanswered; at 3 it sets brief_mode paused and pending_ask "brief paused, ask whether to bring it back".
- The main agent, on an owner message, sets owner_last_message, unseen 0 and both unanswered counters 0.

## pa:outbox

One line per thing you sent, held or want scheduled. Newest last. Keep 14 days.

```
2026-11-04 08:00 | brief | sent | 3 events, electricity bill due 05.11 (₪412) | L3
2026-11-04 13:40 | mail | held:cap | dentist moved to 06.11 10:00 |
2026-11-04 17:00 | look-ahead | sent | leave by 07:50 for the 08:30 at Azrieli; offered a 07:40 reminder |
2026-11-04 17:00 | look-ahead | schedule | reminder 2026-11-05 07:40 "leave for Azrieli" |
2026-11-05 08:00 | brief | nudge | L3 electricity bill, nudge 2 |
```

Fields: time | kind (brief, look-ahead, mail, watch, nudge, weekly, catch-up) | status | one line of what it said, in the owner's language | open-loop or watch id if any.
Status: sent, held:quiet, held:cap, held:window, schedule, nudge, seen. Only the main agent writes seen.

## pa:open-loops

The ledger of things still in motion. Written only by the main agent in a chat (an owner message, or the turn that relays a run or a mail): when the owner commits to something, waits on someone, or an errand leaves a step. Runs read it and report on it; they never edit it.

```
L3 | pay electricity bill ₪412 | next: owner | due: 2026-11-05 | check: 2026-11-05 | source: mail from the electric company 04.11 | open, nudges 1/3
L4 | refund from the airline for the cancelled flight | next: airline | due: - | check: 2026-11-11 | source: chat 04.11 | open, nudges 0/3
L5 | package from AliExpress at the post office | next: owner | due: 2026-11-09 | check: 2026-11-08 | source: mail | check-in
```

- next is who acts next: owner, a named party, or me.
- check is when to look again. A mail FOLLOWUP becomes a line with the tag check-in. At most five open check-ins at a time; past that, keep the newest five and tell the owner which one you stopped following.
- Nudges: when a check date has passed with no movement, the brief mentions it once and writes a nudge line to pa:outbox; the next nudge waits 3 days; after 3 nudges, the main agent asks once whether to drop it.
- Ends with status done or dropped and the date; the nightly tidy moves closed lines out after 7 days.

## pa:profile

What you know about the owner, in Instinct's three headers plus their rules.

```
# Life context
city, home area, work, the people who matter (name, relation, how to refer to them), standing preferences (diet, airline, seat, supermarket, car)
# Autonomy calibration
default: ask before money, time commitments and other people; act on reads, drafts, reminders.
granted: book restaurant tables under ₪150 without asking (owner, chat 2026-11-04)
# Channel style
language, short or detailed, quiet hours, emojis yes/no, brief time, look-ahead on/off, calendar triggers available: <list or none>
# Owner's rules
R1 | no alerts about newsletters at all | scope: mail | 2026-11-04 | source: chat | review: 2027-02-02
```

Rules are one sentence each. The review date is 90 days after the date; when it passes, the tidy sets pending_ask to confirm it once. Autonomy grows only from the owner's own words, never from a run of yeses.

## pa:watches

```
W1 | price of the Sony WH-1000XM6 under ₪1,100 | source: https://example.co.il/item | cadence: 6h | expires: 2026-11-18 | approval: alert only | last: ₪1,249 on 2026-11-04 | active | automation: watch W1
```

approval is "alert only" unless the owner pre-approved the item and a ceiling inside the ₪200 gate ("buy if under ₪180"). At most three active watches. status: active, hit, expired, paused.
