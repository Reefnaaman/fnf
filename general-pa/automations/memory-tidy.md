---
name: Memory tidy
cron: 30 3 * * *
timezone: Asia/Jerusalem
created_by: pa-onboarding, in chat, without asking (it never sends anything)
---
Run the about-me skill, section "Nightly tidy". This run never sends a message: do not call chat_say at all, whatever you find. Only read and update the pa: notes. Never delete a note, an automation or a memory.
