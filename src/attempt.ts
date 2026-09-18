const ANSI = /\u001B\[[0-9;]*m/g;
const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HEX = /\b[0-9a-f]{8,}\b/gi;
const PIXEL_DIFF = /\d+ pixels? \(ratio [^)]+\)/gi;
const HEAD = 80;

export function cleanErrorMessage(message: string): string {
  return message.replace(ANSI, "");
}

export function normalizeErrorHead(message: string): string {
  let text = cleanErrorMessage(message).replace(/\s+/g, " ").trim();
  text = text.replace(UUID, "<id>");
  text = text.replace(LONG_HEX, "<hex>");
  text = text.replace(PIXEL_DIFF, "<pixels>");
  return text.slice(0, HEAD);
}

export function deriveApiName(errorMessage: string, stepTitles: string[] = []): string {
  const message = cleanErrorMessage(errorMessage);
  const expectMatch = message.match(/expect\([^)]*\)\.(\w+)/i);
  if (expectMatch) return `expect.${expectMatch[1]}`;

  const apiMatch = message.match(/\b(page\.\w+|locator\.\w+|browser\.\w+|context\.\w+)/i);
  if (apiMatch) return apiMatch[1];

  for (const title of stepTitles) {
    const fromStep = cleanErrorMessage(title).match(/\b(page\.\w+|locator\.\w+|expect\.\w+)/i);
    if (fromStep) return fromStep[1];
  }

  return "unknown";
}

export function signatureOf(attempt: { apiName: string; errorMessage: string }): string {
  return `${attempt.apiName}|${normalizeErrorHead(attempt.errorMessage)}`;
}
