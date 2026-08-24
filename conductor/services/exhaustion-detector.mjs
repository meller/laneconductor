// Shared provider-exhaustion detection, used both to decide whether a
// failed lane action should re-queue without consuming a retry and whether
// to mark a provider globally exhausted. Previously duplicated inline in
// two places in laneconductor.sync.mjs, both using bare `content.includes`
// substring checks against the full raw log — see track-1112 dogfood
// incident in exhaustion-detector.test.mjs for why that's unsafe for
// 'claude' (short digit runs and common words collide with normal log
// content at scale).
export function isProviderExhausted(content, cli) {
  if (!content || !cli) return false;

  if (cli === 'gemini' || cli === 'npx' || cli === 'antigravity' || cli === 'agy') {
    const geminiMatch = content.match(/quota will reset after\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i);
    const hasReset = Boolean(geminiMatch && (geminiMatch[1] || geminiMatch[2] || geminiMatch[3]));
    return hasReset || content.includes('exhausted your capacity') || content.includes('code: 429');
  }

  if (cli === 'claude') {
    return /\b429\b/.test(content)
      || content.includes('Overloaded')
      || content.includes('Rate limit')
      || content.includes('hit your limit')
      || /resets\s+\d+(am|pm)/i.test(content);
  }

  return false;
}
