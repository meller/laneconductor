/**
 * LaneConductor Canonical Provider Registry
 * Single source of truth for "what AI providers exist / what are their
 * models" — the CLI wizard, sync worker, Collector API, and every React
 * component that shows a provider icon/label/model list all read from
 * this file (or, for the browser bundle, a byte-identical mirror of it —
 * see ui/src/lib/providers.js) instead of keeping their own copy.
 */

export const PROVIDERS = {
  claude: {
    id: 'claude',
    label: 'Claude',
    icon: '🤖',
    aliases: [],
    models: [
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 ✨' },
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
      { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },
      { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    icon: '✨',
    aliases: [],
    retired: true,
    retiredMessage: 'Gemini CLI was retired by Google — antigravity is now recommended.',
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro ✨' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ],
  },
  copilot: {
    id: 'copilot',
    label: 'Copilot',
    icon: '✈️',
    aliases: [],
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'o3', label: 'o3' },
      { id: 'o3-mini', label: 'o3-mini' },
      { id: 'o1', label: 'o1' },
    ],
  },
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity',
    icon: '🚀',
    aliases: ['agy'],
    models: [
      { id: 'auto', label: 'Auto (recommended)' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    ],
  },
};

// 'other' is deliberately NOT a registry entry — it's a free-text escape
// hatch each consumer handles on its own (custom CLI command / model id).
export const PROVIDER_IDS = Object.keys(PROVIDERS);

const ALIAS_TO_CANONICAL = {};
for (const provider of Object.values(PROVIDERS)) {
  for (const alias of provider.aliases || []) {
    ALIAS_TO_CANONICAL[alias] = provider.id;
  }
}

/**
 * Resolves a legacy alias (e.g. 'agy') to its canonical provider id.
 * Ids that are already canonical, or unrecognized (including 'other' and
 * free-text ids), pass through unchanged.
 */
export function normalizeProviderId(id) {
  if (id == null) return id;
  return ALIAS_TO_CANONICAL[id] || id;
}

/** Icon for a provider id, with a generic fallback for unrecognized ids. */
export function providerIcon(id) {
  const provider = PROVIDERS[normalizeProviderId(id)];
  return provider ? provider.icon : '🤖';
}

/** Display label for a provider id, with a generic fallback (never a claude-specific one). */
export function providerLabel(id) {
  const provider = PROVIDERS[normalizeProviderId(id)];
  if (provider) return provider.label;
  if (!id) return 'AI';
  return String(id).charAt(0).toUpperCase() + String(id).slice(1);
}

/**
 * First (recommended) model id for a provider, or null if the id isn't a
 * recognized provider — never another provider's model id.
 */
export function defaultModelFor(id) {
  const provider = PROVIDERS[normalizeProviderId(id)];
  return provider?.models?.[0]?.id ?? null;
}
