const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "Bearer <redacted>"],
  [/\b(?:sk|pk|ts|ghp|gho|glpat|xox[baprs])[-_][A-Za-z0-9_-]{6,}\b/g, "<redacted-key>"],
  [
    /\b(password|passwd|token|secret|api[_-]?key)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    "$1$2<redacted>",
  ],
];

/**
 * Strip obvious credentials from error text before it leaves the machine for
 * TypeSafe. Applied to the Jev state only; signatures stay computed on the raw
 * message so local clustering is unaffected.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
