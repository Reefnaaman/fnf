# @open-instinct/whatsapp

The WhatsApp channel for F&F. It talks to the local whatsapp-connector daemon
(a clone at `daemon/`, never modified) over its unix socket and gives the agent
one chat: the owner's.

| Piece | What it does |
|---|---|
| `DaemonRpc` | `POST /rpc` over the daemon's socket; daemon errors become `DaemonError` with the daemon's code, an unreachable daemon is `DAEMON_DOWN` |

See `docs/superpowers/specs/2026-10-19-fnf-whatsapp-assistant-design.md`.
