/** WhatsApp accepts far longer messages than iMessage; past this they read badly on a phone. */
export const WHATSAPP_MAX_CHARS = 3000;

/**
 * Split long text into several sends. Prefer paragraph breaks, then sentence ends,
 * then spaces, so each bubble reads as a whole thought (same rules as the Inkbox channel).
 */
export function splitMessageText(text: string, max = WHATSAPP_MAX_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed ? [trimmed] : [];
  const parts: string[] = [];
  let rest = trimmed;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < max * 0.4) cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("! "), window.lastIndexOf("? "));
    if (cut < max * 0.4) cut = window.lastIndexOf(" ");
    if (cut < max * 0.4) cut = max;
    else cut += 1;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}
