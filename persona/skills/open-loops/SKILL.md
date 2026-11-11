---
name: open-loops
description: The list of things still open for the owner. Use when the owner commits to something ("אני אתקשר לאינסטלטור מחר"), says they are waiting on someone or something (a reply, a refund, a delivery, a quote), when an errand or a mail leaves a step undone, when a loop closes ("סגרתי", "הגיע", "שילמתי"), when the morning brief or a check-in needs to know what is still open, and when the owner asks "מה פתוח?" or "על מה אני מחכה?". Keeps one short line per loop in the note "open-loops" and nudges at the right time, so nothing gets dropped.
---

# Open loops

Have the owner's back: everything they promised, are waiting for, or left half done sits in one short list, and you bring it up at the right time instead of hoping memory recalls it.

## The note

Note "open-loops", one line per loop, newest last:

`<what, a few words> | <who acts next: owner / name> | due <DD.MM or -> | next check <DD.MM> | <from: chat / mail / errand> | nudges <n>`

At most 15 lines. When full, drop the oldest line that has no due date and say nothing about it.

Only the chat with the owner changes the list. An automation run (brief, check-in) reads it and mentions what is due, but does not edit it or schedule anything from it.

## Add a line

- The owner commits to something with a time or a person: "אני אשלח לו מחר", "צריך לחדש את הדרכון".
- The owner is waiting on someone: a reply, a quote, a refund, a delivery, a booking confirmation.
- An errand stops before the end (waiting for the owner's yes, a code, a call back), or a mail alert has a next step the owner has not taken.
- Not for things already handled by a reminder automation, and not for wishes without a step ("פעם צריך לנסוע ליפן").

Do it quietly in the same turn. Confirm only when it adds something ("רשמתי, אזכיר ביום חמישי אם לא חזרו אליך").

next check: a date one day after the due date, or 3 days from today when there is none.

## Close a line

When the owner or a mail shows it is done ("שילמתי", "הגיע", "ענו לי"), remove the line. No confirmation needed beyond the reply you were writing anyway.

## Nudge

- The morning brief lists loops whose next check is today or past, one line each, same wording as last time. Before listing a loop, re-check it when you can (the mail thread, the calendar); a loop that turns out closed is not listed.
- When the owner next writes after a brief that listed loops, update those lines in the chat: nudges +1 and next check 3 days later.
- A loop with a fixed time that matters (a call at 14:00, a payment due tomorrow) gets a one-off automation "מעקב: <three or four words>", created from the chat only, at most 5 open check-ins in total (shared with mail watch). Its prompt says what to check, to answer with nothing if it is already done, and otherwise to say it in one line with the next step offered.
- After 3 nudges with no change, ask once in one line whether to keep it or drop it ("עדיין רלוונטי לך הצעת המחיר מהקבלן, או למחוק?"). Drop it on a no or on silence after the next brief.

## Asked "מה פתוח?"

Answer from the note, most urgent first, one line each, at most 6, then "יש עוד X" if there are more.

## Do not

- Do not nudge about the same loop twice in one day.
- Do not turn loops into tasks the owner did not ask for; offers are fine.
- Do not mention the note or how you track things.
