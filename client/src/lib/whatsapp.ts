// A WhatsApp link is the one place DueWeave reaches outside itself, so the number it
// puts in that link has to be the number the owner meant. Anything that cannot be
// placed inside India's own numbering is refused rather than guessed: opening a
// stranger's chat is worse than opening none.

export type WhatsAppRecipient = { kind: "direct"; internationalDigits: string } | { kind: "choose-contact" };

const MOBILE_FIRST_DIGIT = /^[6-9]/;

export function whatsappRecipient(raw: string | null | undefined): WhatsAppRecipient {
  // Display punctuation is how people write numbers down, not part of the number.
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 10 && MOBILE_FIRST_DIGIT.test(digits)) return { kind: "direct", internationalDigits: `91${digits}` };
  if (digits.length === 11 && digits.startsWith("0") && MOBILE_FIRST_DIGIT.test(digits.slice(1))) return { kind: "direct", internationalDigits: `91${digits.slice(1)}` };
  if (digits.length === 12 && digits.startsWith("91") && MOBILE_FIRST_DIGIT.test(digits.slice(2))) return { kind: "direct", internationalDigits: digits };
  return { kind: "choose-contact" };
}

export function whatsappUrl(recipient: WhatsAppRecipient, message: string) {
  // The message is escaped once, here, so no caller can half-escape it. The
  // choose-contact form carries no number at all: WhatsApp picks the person.
  return `https://wa.me/${recipient.kind === "direct" ? recipient.internationalDigits : ""}?text=${encodeURIComponent(message)}`;
}

export function whatsappActionLabel(recipient: WhatsAppRecipient, clientLabel: string) {
  if (recipient.kind === "choose-contact") return "Choose contact in WhatsApp";
  const name = clientLabel.trim();
  return `Open WhatsApp for ${name || "this client"}`;
}
