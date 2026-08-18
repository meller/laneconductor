#!/usr/bin/env node
// conductor/services/model-discovery-merge.mjs
// Track 1117 Bug 3: refreshModels() merges a worker's live model discovery
// (discoverAvailableModels — a real `claude models list` shell-out, or the
// equivalent for other providers) with this project's static per-provider
// presets (PROVIDERS[cli].models). Presets exist so the model picker still
// has something to offer when discovery itself fails or a provider has no
// listing command at all — they are a FALLBACK, not a permanent overlay.
//
// The bug: the old merge unconditionally appended every preset not already
// present in `discovered`, even when discovery succeeded and simply omitted
// a given id on purpose (retired, access revoked). A successful discovery
// that omits an id IS the signal that model is gone — layering the preset
// back on top silently overrode that signal. Confirmed live: claude-3-5-haiku
// kept showing up in a worker's reported available_models — and got offered
// by pickers as "genuinely available" — well after a real `claude models
// list` run stopped including it, because the preset kept getting merged
// back in every 30-minute refresh. The real CLI then rejected it outright at
// spawn time.
export function mergeDiscoveredWithPresets(discovered = [], presets = []) {
  return discovered.length > 0 ? discovered : presets;
}
