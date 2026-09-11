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

// A CLI given an unrecognized/unsupported --model value does not reliably
// exit non-zero — confirmed live against the real `claude` binary: it
// prints an error to its own output and still exits 0. isSuccess (a bare
// `code === 0` check in laneconductor.sync.mjs) is fooled by this, and
// none of the failure-only detectors below it (isProviderExhausted,
// isResumeFailure) ever run, because they're all gated on `!isSuccess` —
// so a run that did zero real work due to a bad model string gets counted
// as a pass and the lane action advances anyway. Confirmed against two
// independently-observed error shapes: this CLI's own
// "[claude-code:unrecognized_model]" / "isn't described by this version's
// model catalog", and a differently-worded one from whatever the IDE
// integration in question actually invokes ("invalid model selection...
// model X is not recognized"). Matched on phrasing rather than either
// tool's exact wording, so a third tool's own variant is still caught.
export function isModelMisconfigured(content) {
  if (!content) return false;
  return content.includes('claude-code:unrecognized_model')
    || /model catalog/i.test(content)
    || /invalid model selection/i.test(content)
    || /model\s+["'“]?[\w.-]+["'”]?\s+is not recognized/i.test(content)
    || /issue with the selected model/i.test(content);
}
