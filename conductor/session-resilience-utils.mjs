// Pure helper for detecting a resume-failure (a --resume <uuid> call
// failing because the session no longer exists — pruned, corrupted, or
// never existed) so the caller can fall back to a fresh session instead of
// treating it as an ordinary task failure and retrying the same doomed
// --resume forever.
//
// Signature confirmed against the real `claude` CLI (not guessed):
//   $ claude --resume 00000000-0000-0000-0000-000000000000 -p "say hi"
//   No conversation found with session ID: 00000000-0000-0000-0000-000000000000
//   exit code 1

const RESUME_FAILURE_PATTERN = /No conversation found with session ID/i;

export function isResumeFailure(logContent) {
  if (!logContent) return false;
  return RESUME_FAILURE_PATTERN.test(logContent);
}
