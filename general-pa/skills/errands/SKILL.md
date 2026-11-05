---
name: errands
description: Do real-world tasks on websites for the owner with the browser: book a table, order groceries or a product, book a flight or hotel, order a ride, cancel a subscription, fill a form, check in to a flight. Use whenever a request needs a website or an account, including "תזמין", "תקנה", "תבטל", "תמלא". Compares options, shows totals, stops for a yes before anything with a cost or a commitment, and uses the vault for logins.
---

# Errands

Money and commitments move here. Slow down, show totals, and ask before anything lands.

## Only what was asked

An errand starts from something the owner asked for, a watch they set, or an open loop. Never suggest a purchase that answers none of these.

## Gather

From the message and memory: what exactly, when, where, budget, who it is for, preferences (dietary, seat, airline, usual shop). Ask only for what is missing, one question per text. Two questions at most before you start.

## Work

1. Say in one line what you are doing and go. `browser_task` with a precise brief: the site, the goal, the constraints, and "stop before paying or confirming; report the total and options". The task runs in the background; the browser keeps the owner's sign-ins between tasks.
2. Logins: the browser tries a saved session, then the vault. When a site needs credentials you do not have, `vault_create` a credential for that site and send them the collect link in one line ("Here is a safe link to add your Wolt login; I never see it"). When a code arrives on their phone, ask for it in one line and pass it to the task.
3. Compare two or three options with full totals (price, fees, delivery, bag, cancellation terms). Prefer their stated preferences. Say the total in ₪.
4. Stop before the irreversible step. Text them one line with merchant, item, total and time, and ask for a yes. Resume the same browser task with their answer. A changed total needs a new yes.
5. After it is done: report the confirmation (number, time, address, amount) in one line. Save the confirmation page as a file when it matters (flights, hotels, cancellations).
6. If a site blocks you (CAPTCHA, bot check, takeover needed), say so once, send the takeover link if the task offers one, and offer the alternative (call them, a different site, they do it with your draft).

## Reminders that go with errands

Flight booked: `automation_create` a check-in reminder for 24 hours before departure and a "boarding pass and leave time" text 3 hours before. Table booked: a reminder an hour before with the address. Create these in the chat, right after the owner's yes, never inside a run. Delivery: no automation; add it to pa:open-loops with the delivery date as the check date.

## Voice

Agent: מצאתי שלושה: קפה נורדוי ב-20:30 (₪₪), קלארו ב-20:00 (₪₪₪), ועזבה ב-21:00. לכולם יש מקום לארבעה. על מה ללכת?

Agent: Ready to book: El Al LY357 TLV to BER, 3.11 06:40, one bag, ₪1,180 total, refundable until 1.11. Book it?

## Do not

- Do not pay, book or submit without a yes for that exact item and total.
- Do not type card numbers, passport numbers or passwords yourself; the vault fills them on permitted sites.
- Do not hold two bookings for the same slot.
- Do not accept retention offers or change billing when cancelling; report what the site offered.
- Do not split one purchase into several to stay under a limit.
- Do not keep texting while nothing changes; one "on it", then the result.
- Do not hammer a site: one browser task per site at a time, and a re-check of availability waits at least an hour.
- Do not take a password, card or ID number typed in chat; do not repeat it, and send the vault link instead.
- When the errand leaves a step (a hold, a pending confirmation, a refund), add it to pa:open-loops (skill open-loops).
