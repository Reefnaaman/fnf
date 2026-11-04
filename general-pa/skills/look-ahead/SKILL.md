---
name: look-ahead
description: Afternoon look at tomorrow. Use when the "Look-ahead" automation runs (around 17:00, Sunday to Thursday), when the owner asks "what's tomorrow" or "מה יש מחר", or when turning the look-ahead on, off or to another time. Usually silent; speaks only when tomorrow needs prep, and then as an offer a one-word yes settles.
---

# Look-ahead

Like an assistant who glances at tomorrow before going home: most days there is nothing to say. In an automation run nobody can answer you, and you never create automations: an offered reminder goes to pa:outbox as a schedule line, and the main agent creates it when the owner says yes.

## Check

1. pa:proactive-log and pa:outbox first (proactive_rules: window, quiet hours, what was already said). brief_mode paused also pauses the look-ahead.
2. Tomorrow's calendar. For each event, ask: does it need prep tonight or an early start?
   - Travel: an event with a place. Estimate the trip from the home area in pa:profile with the sandbox, by car: geocode with `curl -s "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=<place>" -H "User-Agent: pa"` and route with `curl -s "https://router.project-osrm.org/route/v1/driving/<lon1>,<lat1>;<lon2>,<lat2>?overview=false"`. Add 15 minutes of margin. It is an estimate without traffic; say "about".
   - An early first event (before 09:00), back-to-back events with travel between them, something to bring (documents, a gift, a laptop), a booking to confirm.
3. Open loops due tomorrow (pa:open-loops), and the weather if it changes tomorrow's plans (rain on a travel day, a heat warning).

## Speak only if

Something from the check would cost the owner if they learned it tomorrow morning. Otherwise send nothing.

## Write

One to three short lines: the fact, the reason in one clause, then one offer. The data line last.

Agent: מחר ב-8:30 פגישה בעזריאלי. כדי להגיע בזמן כדאי לצאת בערך ב-7:50, לפי הערכה בלי פקקים. להזכיר לך ב-7:40? בדקתי: יומן, מסלול מהבית.

Agent: Tomorrow's 09:00 with the bank needs your ID and the signed form. Want a reminder at 08:15? Checked: calendar, the bank's invite.

Write a pa:outbox line for the message, and for the offer a schedule line: "schedule | reminder 2026-11-05 07:40 \"leave for Azrieli\"". When the owner answers yes in the chat, create a one-off automation (at) with that time and a prompt that sends the reminder in one line, then mark the schedule line seen.

## Do not

- Do not send on Friday or Saturday, or on a day with nothing to prepare.
- Do not repeat what the morning brief or an earlier message already said.
- Do not book a ride or anything else; offer it.
