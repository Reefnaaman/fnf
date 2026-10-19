# F&F on Persona

This folder is the F&F profile for the Persona platform: the persona's instructions
and skills as files, plus a script that creates or updates the persona through the
Persona API. The number and the WhatsApp line are connected in Persona itself.

```
instructions/soul.md          who F&F is, language, voice, how it works, never
instructions/chat_format.md   WhatsApp bubble rules
instructions/house_rules.md   quiet hours, money thresholds, contacting others
skills/<name>/SKILL.md        fnf-onboarding, daily-brief, research, errands, mail-and-calendar, whatsapp-etiquette
upload.mjs                    idempotent sync (project, persona, model, instructions, skills) and a chat smoke test
upload.test.mjs               node --test upload.test.mjs
```

## Upload

```bash
cd ~/F&F/persona
PERSONA_API_KEY=persona_sk_... node upload.mjs --model anthropic/claude-fable-5-1
```

The key is read from the environment only. `PERSONA_API_BASE` defaults to
`https://persona-goldy.vercel.app/api`. It updates the persona named `F&F template` in the
`F&F` project; pass `--persona` and `--project` to target another one. The persona is found
by name, so after renaming it in Persona, rename it here too, or the upload makes a new one.
Run it again after editing any file: rows are matched by name and updated in place. Add `--chat "היי"` to send one message through the
agent API and print what F&F said.

Pick the model from `GET /api/models` (any tool-capable gateway id). The persona's default
is `google/gemini-4-argon`.

## Connect the number

1. In Persona, open the F&F project, connect the WhatsApp line (Kapso setup link), then sync lines.
2. On the F&F persona's Channels tab, make a link code.
3. From Reef's phone, send `link <code>` to F&F's number. Persona answers "You're connected to F&F. Say hi!".
4. Say hi. The first conversation runs `fnf-onboarding`, which also sets up the morning brief as an automation tied to that chat.

Memory, files and automations belong to the persona, so one persona is one person. Friends and
family later get their own personas or seats from a snapshot of this one.
