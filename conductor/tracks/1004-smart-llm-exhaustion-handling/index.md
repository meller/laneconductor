# Track 1004: Smart LLM Provider Exhaustion Handling

**Lane**: done
**Lane Status**: success
**Progress**: 100%

## Problem
Currently, when an LLM provider (Claude or Gemini) is exhausted (rate limited), the LaneConductor worker enters a tight retry loop, spawning processes that fail immediately. There is no clear visibility in the UI about the provider's health or reset time.

## Solution
Implement a provider-aware backoff mechanism that detects exhaustion errors, calculates/extracts the retry delay, and prevents spawning new tasks for that provider until the delay expires. Surface this status on the Vite dashboard.

## Phases
- [x] Phase 1: Exhaustion Detection and State Management
- [x] Phase 2: Worker Backoff Logic
- [x] Phase 3: Dashboard Integration
