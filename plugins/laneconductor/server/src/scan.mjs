// Privacy scan for text that is about to be published (track AM-10106, Phase 5d Task 7). Pure.
// `scanText(text)` returns `[{ line, pattern }]`, one entry per match. It NEVER returns, logs or
// throws the matched text: callers see a 1-based line number and the name of the pattern class, so
// a result can be printed or stored without leaking what it found. Any match means "do not publish
// this file"; the caller withholds the whole file rather than redacting it.
//
// The secret patterns follow the ones in connector/test/plugin-build.test.mjs. A similar scanner
// exists as connector/src/recipes/scan on the track-10107 branch; the two should be merged into one
// module later (this one is deliberately left independent of that branch).

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

const RULES = [
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'Anthropic or OpenAI key', re: /(?<![A-Za-z0-9])sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/g },
  {
    name: 'connection string with password',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^/\s:@]+:[^/\s@]{3,}@([^/\s:?#]+)/gi,
    keep: (m) => !LOCAL_HOSTS.has(m[1].toLowerCase()),
  },
  {
    // `password = value`: a quoted value of 8+ characters, or a bare value of 8+ characters that mixes
    // letters and digits. References such as $VAR, <placeholder>, {{template}} or env lookups are not values.
    name: 'credential assignment',
    re: /(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\s*[:=]\s*(?:"([^"\s]{8,})"|'([^'\s]{8,})'|`([^`\s]{8,})`|([^\s"'`<>$,;(){}[\]]{8,}))/gi,
    keep: (m) => {
      if (m[1] || m[2] || m[3]) return !/^(?:\$|<|\{|process\.env|env\.)/.test(m[1] || m[2] || m[3]);
      const v = m[4];
      return /[A-Za-z]/.test(v) && /\d/.test(v) && !/^(?:process\.env|env\.)/.test(v);
    },
  },
  {
    name: 'email address',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
    only: (line) => line.includes('@'),
    keep: (m) => !isPlaceholderEmail(m[0]),
  },
  { name: 'phone number', re: /(?<![\w+-])(?:\+\d{1,3}[ -]?\(?\d{1,4}\)?(?:[ -]\d{2,4}){2,4}|\(\d{2,4}\)[ -]?\d{3,4}[ -]\d{3,4}|\d{2,4}-\d{3,4}-\d{3,4}|0\d{1,2}-\d{7,8})(?![\w-])/g, keep: (m) => m[0].replace(/\D/g, '').length >= 7 },
];

const PLACEHOLDER_DOMAIN_RE = /(?:^|\.)(?:example\.(?:com|org|net)|example|invalid|test|localhost|local|domain\.com|email\.com|yourdomain\.com|company\.com)$/i;

// Not personal data: noreply addresses, obvious placeholders (user@example.com) and the `git@host`
// of an SSH remote.
function isPlaceholderEmail(addr) {
  const at = addr.lastIndexOf('@');
  const local = addr.slice(0, at).toLowerCase();
  const domain = addr.slice(at + 1).toLowerCase();
  return /no-?reply/.test(addr.toLowerCase()) || PLACEHOLDER_DOMAIN_RE.test(domain) || local === 'git';
}

/**
 * @param {string} text
 * @returns {{ line: number, pattern: string }[]} never the matched text
 */
export function scanText(text) {
  const out = [];
  if (typeof text !== 'string' || text === '') return out;
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 7) continue;
    for (const rule of RULES) {
      if (rule.only && !rule.only(line)) continue;
      rule.re.lastIndex = 0;
      for (const m of line.matchAll(rule.re)) {
        if (rule.keep && !rule.keep(m)) continue;
        out.push({ line: i + 1, pattern: rule.name });
      }
    }
  }
  return out;
}
