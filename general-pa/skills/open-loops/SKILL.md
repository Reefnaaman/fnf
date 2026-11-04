---
name: open-loops
description: The ledger of things still in motion (pa:open-loops). Use in chat whenever the owner commits to something ("I'll call him tomorrow", "אני אשלם ביום חמישי"), waits on someone (a reply, a refund, a delivery, a quote), an errand leaves a step, or a mail FOLLOWUP arrives; when they ask "what's open" or "מה פתוח"; and when they say something is done or can be dropped.
---

# Open loops

Things the owner would be annoyed to forget. The ledger is pa:open-loops (format in skill pa-notes). Only you, in a chat turn, write it; the brief and the look-ahead read it and report on it.

## Add a loop

Add one line when:
- the owner commits to something with a time or a person ("I'll send the contract Thursday");
- they wait on someone else (a reply promised by a date, a refund, a delivery, a quote, a callback);
- an errand leaves a step (a booking waiting for confirmation, a form that needs a signature);
- a mail run ends with a FOLLOWUP line (tag check-in).

Fill: what (short, in their language), next (owner, the other party, or me), due (a date or -), check (when to look again: the due date, the promised date, or 3 days from now), source (chat with today's date, or "mail from <sender>"), status open, nudges 0/3. Never add a loop for something already done in the same turn. Do not announce routine check-ins; for a commitment of theirs, confirm in a few words ("Noted, I'll keep it in mind for Thursday").

Keep at most five open check-ins; past that, keep the newest five and tell the owner in one line which one you stopped following.

## Update

- Movement (the reply came, the refund landed, they paid): mark done with the date and say it in one line if they did not tell you themselves.
- They say "done", "forget it", "תוריד את זה": done or dropped, confirm in a few words.
- On every owner message, catch_up_on_return moves nudge counts from pa:outbox "nudge" lines into the ledger.
- After the third nudge with no movement, ask once: "Still want me to follow the <what>, or drop it?" Then do what they say.

## "What's open"

One line per open loop, most urgent first: what, who acts next, due date. Then at most one offer.

Agent: פתוחים כרגע שלושה: חשבון החשמל, 412 ₪ עד מחר, אצלך. ההחזר מאל על, אצלם, בודק שוב ב-11.11. החבילה בדואר בהרצל, עד 9.11. לשלם את החשמל עכשיו?

## Do not

- Do not nudge in chat replies; nudges belong to the brief.
- Do not create an automation per loop; the brief and the look-ahead check the ledger. Create a one-off reminder only when the owner asks for one.
- Do not keep a loop the owner closed.
