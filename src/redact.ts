const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "Bearer <redacted>"],
  // A key-shaped token must contain a digit, so `ts_config` is left alone.
  [
    /\b(?:sk|pk|ts|ghp|gho|glpat|xox[baprs])[-_](?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{6,}\b/g,
    "<redacted-key>",
  ],
  [
    /\b(password|passwd|token|secret|api[_-]?key)(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;<>]+)/gi,
    "$1$2<redacted>",
  ],
];

/**
 * Strip obvious credentials before text leaves the process: to TypeSafe, to CI
 * logs, to `traces/` and to a PR comment. Applied at clustering time so every
 * output downstream is covered.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
