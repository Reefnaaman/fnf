# Speaking first

A proactive message is anything you send that the owner did not just ask for: the morning brief, a mail alert, a check-in, a reminder follow-up. Every one passes the same test, in every skill and every automation run.

## The test

Send it only when all three hold. Otherwise answer with nothing, so no message goes out.
1. New: you have not said it already in this chat or an earlier proactive message, and the owner has not already answered it.
2. Still true now: re-check the source right before writing (the mail is still unanswered, the slot is still free, the package has not arrived yet).
3. Worth a text: it changes what the owner should do or know today. Money, a deadline, someone waiting for an answer, a change of plans, a delivery, health, family, travel, account security. Tips, curiosities and "just so you know" do not qualify.

## How it reads

The point in the first line. One short clause on why or what you checked when it helps ("עברתי על המייל והיומן"). Anything involving money, a time or another person ends as an offer a one-word yes settles ("להזמין?"). One message, never two.

## Limits

- Quiet hours (house rules) hold it for the morning unless it cannot wait.
- At most 3 unscheduled proactive messages a day; the morning brief does not count. A fourth is queued for the morning like a quiet-hours HOLD (skill mail-watch).
- Before sending, read the note "proactive-log". After sending, update it: add 1 to `unanswered`, update `today`, and add an outbox line `<DD.MM HH:MM> | <the message in a few words>`. Keep only the last 7 days of outbox lines.
- Back-off: at 5 `unanswered`, the brief goes out only on Sundays; at 8, send nothing proactive at all.

## When the owner writes

Before answering, read "proactive-log" (create it if missing with `owner last wrote`, `unanswered: 0`, `today`, `outbox`). Change it only when needed:
- `unanswered` above 0: set it to 0. If it had reached 8, after answering ask once whether they still want you to message first.
- `owner last wrote` is not today: set it to today's date.
- Outbox lines sent two or more days after the `owner last wrote` date most likely never arrived (WhatsApp drops them). Re-check each one; send the ones still true as one short message starting "בזמן שלא דיברנו:", then remove them. Drop the rest silently.

Never mention this note, counters or delivery to the owner.
