export { DaemonError, DaemonRpc, type DaemonRpcOptions } from "./rpc.js";
export { WhatsAppChannel, CONVERSATION_PREFIX, DELAYED_PREFIX, type WhatsAppChannelOptions } from "./channel.js";
export { splitMessageText, WHATSAPP_MAX_CHARS } from "./split.js";
export { OutboxQueue, DEFAULT_QUEUE_MAX_AGE_MS, type QueueEntry, type OutboxQueueOptions } from "./queue.js";
export { Cursor } from "./cursor.js";
export { WhatsAppInbox, DEFAULT_POLL_MS, MAX_POLL_MS, GRACE_SECONDS, type WhatsAppInboxOptions, type DaemonMessage } from "./inbox.js";
export { transcribeAudio, DEFAULT_TRANSCRIPTION_MODEL, TRANSCRIPTION_URL, type TranscribeOptions } from "./transcribe.js";

export interface WhatsAppSettings {
  socketPath: string;
  /** A validated 1:1 chat id (`<digits>@c.us` or `<digits>@lid`). */
  ownerChatId?: string;
  /** Set when FNF_WHATSAPP_OWNER_CHAT is present but is not a 1:1 chat id (a group, a name). */
  ownerChatInvalid?: string;
}

/** Only a 1:1 chat binds the sender to a number. Groups (`@g.us`) and names never qualify. */
export const OWNER_CHAT_ID_PATTERN = /^\d+@(c\.us|lid)$/;

/** FNF_WHATSAPP_SOCKET turns the channel on; FNF_WHATSAPP_OWNER_CHAT names the one chat it may use. */
export function whatsappSettings(env: NodeJS.ProcessEnv): WhatsAppSettings | undefined {
  const socketPath = env.FNF_WHATSAPP_SOCKET?.trim();
  if (!socketPath) return undefined;
  const raw = env.FNF_WHATSAPP_OWNER_CHAT?.trim();
  if (!raw) return { socketPath };
  return OWNER_CHAT_ID_PATTERN.test(raw) ? { socketPath, ownerChatId: raw } : { socketPath, ownerChatInvalid: raw };
}
