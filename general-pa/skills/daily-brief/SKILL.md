---
name: daily-brief
description: Proactive morning text. Use when the "Daily brief" automation runs, when the owner asks "what's my day" or "מה יש לי היום", or when setting up, pausing or moving the morning text. Pulls weather, today's calendar, mail that needs them, open loops that are due, and items held overnight into one short message that ends with at most one real decision.
---

# Daily brief

One text, at the time the owner chose, that lets them start the day without opening anything. In an automation run nobody can answer you: gather, write, send; never ask and wait; never create or change automations.

## Before anything

1. Read pa:proactive-log. Apply the back-off: brief_mode sundays and today is not Sunday, or brief_mode paused: send nothing. If owner_last_message is more than 23 hours ago, you will hold instead of send (proactive_rules).
2. If the previous brief line in pa:outbox is still sent (not seen), raise briefs_unanswered (or sundays_unanswered on Sundays) and switch mode when the ladder says so.
3. Read pa:outbox (held items since the last brief, what was already said), pa:open-loops and pa:profile (city, style, rules).

## Collect

Skip any source that is not connected; do not mention the gap.

1. Weather for their city from the sandbox shell: `curl -s "https://wttr.in/<city>?format=j1"` (today's max, min, rain chance, afternoon condition). Never the browser for weather.
2. Calendar: today's events. First event time, anything with a location that needs travel, video calls.
3. Mail: unread since the last brief that needs a reply or a decision (skill mail-and-calendar, read step only).
4. Held items from pa:outbox (quiet hours, cap). Re-check each; drop what is no longer true.
5. Open loops whose check or due date is today or past. A loop with no movement and its last nudge 3 or more days ago gets one line and a nudge line in pa:outbox. After its third nudge, do not nudge again; set pending_ask "drop L<n>?" in pa:proactive-log.
6. Rules due for review (pa:profile) and expired watches: do not mention them; set pending_ask for the main agent.

## Write

4 to 8 lines, plain prose, no headings. Order: greeting with weather, calendar, what needs them, held items, open loops. Skip empty parts. Then the data line ("Checked: calendar, mail since yesterday 18:00, wttr.in."). End with at most one real decision question, the one whose answer matters most today ("Pay the electricity bill now from the saved card?"). A real decision, never "anything else?"; no decision today means no question. On a quiet day, two lines: weather and that nothing is waiting.

Agent: בוקר טוב. 24 ובהיר. שלושה דברים היום: סטנדאפ ב-10 בזום, רופא שיניים ב-14:30 באבן גבירול, וארוחת ערב עם נועה ב-20:00. רואה החשבון מבקש אישור על הדוח עד הצהריים. מחכים עדיין לאישור מהמלון בברלין, בדקתי שוב הבוקר. בדקתי: יומן, מיילים מאתמול ב-18:00, מזג אוויר. לאשר לו את הדוח?

Agent: Morning. 19 and grey. Nothing on the calendar and nothing in mail needs you. Checked: calendar, mail since yesterday 18:00, wttr.in.

## After writing

Add one pa:outbox line for the brief (status sent, or held:window when the window is closed) and one per nudge; update unseen in pa:proactive-log.

## Changes from chat

To change the time: automation_list, then automation_update the cron, and confirm in one line. To pause: automation_update enabled false, never delete. After the first week, if no "Weekly ledger" automation exists and pa:profile has no answer about it, the brief may offer it once: "Want a short Friday note of what I handled quietly this week?" The main agent creates it in chat on a yes:

{{automation:weekly-ledger}}

## Do not

- Do not send more than one brief a day unless asked.
- Do not read mail bodies aloud. Sender and the ask only.
- Do not add tasks they did not ask for; offers are fine, actions are not.
