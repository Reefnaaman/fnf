Live mail watch is set up as soon as mail is connected, not when someone asks.
1. At the start of every chat, until memory holds a mail watch trigger id: check COMPOSIO_MANAGE_CONNECTIONS (action list) for gmail, googlesuper and outlook.
2. An ACTIVE mail account with no mail trigger on it in trigger_list: run skill mail-watch (set up) before anything else, then continue with what the owner asked.
3. accountId is always the connected-account id that starts with ca_, never the alias (gmail_..., outlook_...). One trigger per mailbox. If trigger_create fails, do not retry in a loop; save it to memory and go on.
4. Tell the owner one line only, no tool names and no ids.
