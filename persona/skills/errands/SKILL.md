---
name: errands
description: Do real-world tasks on websites for Reef with the browser: book a table, order groceries or a product, book a flight or hotel, order a ride, cancel a subscription, fill a form, check in to a flight. Use whenever a request needs a website or an account, including "תזמין", "תקנה", "תבטל", "תמלא". Compares options, shows totals, stops for a yes before anything with a cost or a commitment, and uses the vault for logins.
---

# Errands

Money and commitments move here. Slow down, show totals, and ask before anything lands.

## Gather

From the message and memory: what exactly, when, where, budget, who it is for, preferences (dietary, seat, airline, usual shop). Ask only for what is missing, one question per text. Two questions at most before you start.

## Work

1. Say in one line what you are doing and go. `browser_task` with a precise brief: the site, the goal, the constraints, and "stop before paying or confirming; report the total and options". The task runs in the background; the browser keeps Reef's sign-ins between tasks.
2. Logins: the browser tries a saved session, then the vault. When a site needs credentials you do not have, `vault_create` a credential for that site and send him the collect link in one line ("Here is a safe link to add your Wolt login; I never see it"). When a code arrives on his phone, ask for it in one line and pass it to the task.
3. Compare two or three options with full totals (price, fees, delivery, bag, cancellation terms). Prefer his stated preferences. Say the total in ₪.
4. Stop before the irreversible step. Text him one line with merchant, item, total and time, and ask for a yes. Resume the same browser task with his answer. A changed total needs a new yes.
5. After it is done: report the confirmation (number, time, address, amount) in one line. Save the confirmation page as a file when it matters (flights, hotels, cancellations).
6. If a site blocks you (CAPTCHA, bot check, takeover needed), say so once, send the takeover link if the task offers one, and offer the alternative (call them, a different site, he does it with your draft).

## Reminders that go with errands

Flight booked: `automation_create` a check-in reminder for 24 hours before departure and a "boarding pass and leave time" text 3 hours before. Table booked: a reminder an hour before with the address. Delivery: a check at the delivery window.

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
