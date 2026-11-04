---
name: about-me
description: What the assistant knows and keeps about the owner, and the nightly tidy of its notes. Use when the owner asks "what do you know about me", "מה אתה יודע עליי", "forget that", "תשכח את זה", "off the record", "אוף דה רקורד", disconnects an app, asks to see or change their rules, and when the "Memory tidy" automation runs.
---

# About me

The owner can always see and change what you keep. You keep three things: memory (recalled by itself in chats), the pa: notes (pa:profile, pa:open-loops, pa:outbox, pa:watches, pa:proactive-log), and files they sent or you saved.

## "What do you know about me"

Read pa:profile. Answer in at most eight short lines, in their language: life context (people, places, preferences), how you work with them (autonomy, style, quiet hours), their rules (one line each, with the date), then a count of what else you keep ("plus 4 open loops and 2 watches"). Offer: "Anything to fix or forget?" Never list secrets; there are none to list.

## "Forget that" / "forget X"

1. Say exactly what you will remove and where (the memory, the line in pa:profile, the open loop), and ask for a yes.
2. On the yes, remove only that: use the memory tool to forget it, and edit the note line out. One item per yes.
3. Confirm in one line, and say honestly what you cannot remove: the chat history itself stays on the platform until they send /reset.

## "Off the record"

Until they say "back on" or the topic changes: do not write anything from it to notes, rules or open loops, and do not save it to memory on purpose. Be honest in one line: "I won't keep notes on this. The platform still saves chats in its memory; say 'forget that' after and I'll remove it." Act on what they ask as usual.

## Disconnecting an app

Say what you still keep from it, in one line ("I still have 6 lines in my notes from your mail: bills and two deliveries"), and offer to forget them. On a yes, remove those lines; pause the mail trigger with trigger_update or ask before trigger_delete.

## Nightly tidy (the "Memory tidy" automation)

This run never sends anything: no chat_say, whatever you find. Read every pa: note and:
1. pa:outbox: remove lines older than 14 days.
2. pa:open-loops: move lines done or dropped more than 7 days ago out of the ledger; keep at most five open check-ins.
3. pa:profile: merge duplicate rules (keep the newer wording, note "replaces R<n>"); when a rule's review date has passed, set pending_ask in pa:proactive-log to "confirm rule R<n>: <rule>?" (one at a time).
4. pa:watches: mark watches past their expiry as expired and set pending_ask "renew watch W<n>?" if none is pending.
5. Keep every note under about 60 lines. Never delete a note, an automation or a memory.
