---
name: daily-brief
description: Proactive morning text. Use when an automation run says to run the daily brief, when Reef asks "what's my day" or "מה יש לי היום", or when setting up or changing the morning text. Pulls weather, today's calendar, mail that needs him, open loops and anything waiting on his answer into one short message.
---

# Daily brief

One text, at the time Reef chose, that lets him start the day without opening anything. In an automation run nobody can answer you: gather, write, send; do not ask questions.

## Setup and changes

Created during onboarding with `automation_create` (name "Daily brief", cron in Asia/Jerusalem, prompt as in fnf-onboarding). To change the time: `automation_list`, then `automation_update` the cron, and confirm in one line. Weekdays only is `0 8 * * 0-4` (Sunday to Thursday).

## Collect, in order

Skip any source that is not connected; do not mention the gap unless he asked for it before.

1. Weather for his city: a browser task to a weather page is slow; prefer a quick lookup if a weather tool or app is connected, otherwise one short `browser_task` ("today's weather in Tel Aviv, high low and rain chance, text only").
2. Calendar: today's events through the Google Calendar app. First event time, anything with a location that needs travel, video calls.
3. Mail: unread since last evening that needs a reply or a decision (skill mail-and-calendar, read step only). Count the rest.
4. Open loops from memory: things you are waiting on, a delivery, a booking hold, a question he never answered. Repeat an unanswered ask in one line with the same wording.
5. Automations due today that you created (reminders, check-ins), so he knows you have them.

## Write

4 to 8 lines, plain prose, no headings, no emojis unless he uses them. Order: greeting with weather, calendar, mail, waiting on, one offer. Times in Asia/Jerusalem. Skip empty sections. If nothing at all is happening, two lines. If truly nothing matters, answer with nothing so no message is sent.

Agent: בוקר טוב ריף. 24 ובהיר. שלושה דברים היום: סטנדאפ ב-10 בזום, רופא שיניים ב-14:30 באבן גבירול, וערב עם נועה ב-20:00. שני מיילים צריכים אותך, שניהם מרואה החשבון על הדוח. מחכה עדיין לאישור מהמלון בברלין. רוצה שאזמין מונית לרופא השיניים?

Agent: Morning. 19 and grey. Nothing on the calendar and nothing in mail needs you. I'm around.

## Quiet rules

- If the scheduled time falls inside quiet hours, do not send; tell him once and offer to move it.
- Never include the content of other people's messages beyond sender and topic.

## Do not

- Do not send more than one brief a day unless asked.
- Do not read mail bodies aloud. Sender and ask only.
- Do not add tasks he did not ask for; offers are fine, actions are not.
