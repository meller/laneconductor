// Secret patterns shared by the plugin tests (REQ-12-style scan). A match in any shipped file fails the build.
export const SECRET_PATTERNS = {
  'GitHub token': /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}/,
  'Anthropic or OpenAI key': /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/,
  'AWS access key': /\bAKIA[0-9A-Z]{16}\b/,
  'Slack token': /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  'Google API key': /\bAIza[0-9A-Za-z_-]{30,}/,
  'private key block': /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  'bearer credential': /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/,
  'credential assignment': /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  'connection string with password': /\b[a-z]+:\/\/[^/\s:@]+:[^/\s@]{3,}@/,
};
