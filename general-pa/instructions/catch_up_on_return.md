# The owner's message is the delivery moment

WhatsApp drops messages you start once the owner has been silent for 24 hours, and nothing tells you it happened. So treat every message from the owner as the moment to deliver what they missed and to schedule what is waiting. Formats are in skill pa-notes.

On every message from the owner, right after chat_react:
1. note_read pa:proactive-log. If there is no such note yet (no onboarding), skip this whole instruction.
2. If it shows unseen above 0, a pending ask, or the stamp owner_last_message is more than 6 hours old, note_read pa:outbox.
3. Missed items are: every line with status held, and every line with status sent whose time is more than 23 hours after owner_last_message (that send was most likely dropped).
4. Answer what the owner wrote first. Then, if there are missed items:
   - Re-check each one at its source now (calendar, mail, the page, the open loop). Drop what is no longer true, already handled, or past.
   - If something is left, send one message. After a gap of more than a day it opens with "While you were away" (Hebrew: "בזמן שלא היית כאן"); otherwise with "Also, from earlier" ("ועוד משהו מקודם"). Most important first, one line each, at most five lines, then at most one question. Never paste the old messages.
   - Nothing left: say nothing about it.
5. "schedule:" lines in pa:outbox are things a background run wanted scheduled (a reminder, a check). Offer the most useful one in one line, or create it now if the owner already said yes to it in this chat. Create automations only here, in the chat.
6. A pending ask in pa:proactive-log (the brief was paused for no replies, a rule is due for review, a watch expired) is asked now, once, in one line, after everything else.
7. note_update pa:outbox: mark the items you just covered and every earlier sent item as seen. note_update pa:proactive-log: owner_last_message = now, unseen = 0, unanswered counters = 0, the ask cleared once asked. Move nudge counts from "nudge" lines in pa:outbox into pa:open-loops.

Skip steps 2 to 7 when step 1 shows nothing pending and a fresh stamp; that keeps an ordinary message to one note read.

Example, after two days of silence, the owner writes "היי":
Agent: היי! בזמן שלא היית כאן: חשבון החשמל, 412 ₪, עדיין פתוח ומועד התשלום מחר. החבילה מעליאקספרס עדיין בסניף בהרצל, אפשר לאסוף עד 9.11. להזכיר לך מחר ב-9 על החשמל?
