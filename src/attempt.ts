const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_HEX = /\b[0-9a-f]{8,}\b/gi;
const HEAD = 80;

export function normalizeErrorHead(message: string): string {
  let text = message.replace(/\s+/g, " ").trim();
  text = text.replace(UUID, "<id>");
  text = text.replace(LONG_HEX, "<hex>");
  return text.slice(0, HEAD);
}

export function deriveApiName(errorMessage: string, stepTitles: string[] = []): string {
  const expectMatch = errorMessage.match(/expect\([^)]*\)\.(\w+)/i);
  if (expectMatch) return `expect.${expectMatch[1]}`;

  const apiMatch = errorMessage.match(/\b(page\.\w+|locator\.\w+|browser\.\w+|context\.\w+)/i);
  if (apiMatch) return apiMatch[1];

  for (const title of stepTitles) {
    const fromStep = title.match(/\b(page\.\w+|locator\.\w+|expect\.\w+)/i);
    if (fromStep) return fromStep[1];
  }

  return "unknown";
}

export function signatureOf(attempt: { apiName: string; errorMessage: string }): string {
  return `${attempt.apiName}|${normalizeErrorHead(attempt.errorMessage)}`;
}
