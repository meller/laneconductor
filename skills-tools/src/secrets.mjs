// Secret scanner. It reports WHERE a pattern matched (file, line, pattern id) and never
// the matched text, so a finding cannot leak the secret into a log, an error or a chat.
export const SECRET_PATTERNS = [
  { id: 'google_api_key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { id: 'private_key_block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'private_key_json', re: /"private_key"\s*:/ },
  { id: 'github_token', re: /gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{20,}/ },
  // The lookbehind keeps words such as "task-management-..." from matching.
  { id: 'sk_key', re: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/ },
  { id: 'aws_key_id', re: /AKIA[0-9A-Z]{16}/ },
  { id: 'db_url_with_password', re: /postgres(?:ql)?:\/\/[^:/\s]+:[^@\s]+@(?!localhost|127\.0\.0\.1)/ },
];

/** @returns {{ file: string, line: number, pattern: string }[]} one entry per (line, pattern); never the text. */
export function scanText(text, file) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const p of SECRET_PATTERNS) if (p.re.test(line)) out.push({ file, line: i + 1, pattern: p.id });
  });
  return out;
}

/** @param {Record<string, string>|Map<string, string>} files path -> content */
export function scanFiles(files) {
  const entries = files instanceof Map ? [...files] : Object.entries(files);
  return entries.flatMap(([file, text]) => scanText(text, file));
}

export const describeFindings = (findings) => findings.map((f) => `${f.file}:${f.line} (${f.pattern})`).join(', ');
