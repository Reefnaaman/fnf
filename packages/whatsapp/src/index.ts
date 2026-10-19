export { DaemonError, DaemonRpc, type DaemonRpcOptions } from "./rpc.js";
export { WhatsAppChannel, CONVERSATION_PREFIX, DELAYED_PREFIX, type WhatsAppChannelOptions } from "./channel.js";
export { splitMessageText, WHATSAPP_MAX_CHARS } from "./split.js";
export { OutboxQueue, DEFAULT_QUEUE_MAX_AGE_MS, type QueueEntry, type OutboxQueueOptions } from "./queue.js";
export { Cursor } from "./cursor.js";
export { WhatsAppInbox, DEFAULT_POLL_MS, MAX_POLL_MS, GRACE_SECONDS, type WhatsAppInboxOptions, type DaemonMessage } from "./inbox.js";
export { transcribeAudio, DEFAULT_TRANSCRIPTION_MODEL, TRANSCRIPTION_URL, type TranscribeOptions } from "./transcribe.js";

export interface WhatsAppSettings {
  socketPath: string;
  ownerChatId?: string;
}

/** FNF_WHATSAPP_SOCKET turns the channel on; FNF_WHATSAPP_OWNER_CHAT names the one chat it may use. */
export function whatsappSettings(env: NodeJS.ProcessEnv): WhatsAppSettings | undefined {
  const socketPath = env.FNF_WHATSAPP_SOCKET?.trim();
  if (!socketPath) return undefined;
  const ownerChatId = env.FNF_WHATSAPP_OWNER_CHAT?.trim();
  return ownerChatId ? { socketPath, ownerChatId } : { socketPath };
}
