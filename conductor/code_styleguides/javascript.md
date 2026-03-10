# JavaScript Style Guide

## Module System
- ESM throughout — use `.mjs` extension or `"type": "module"` in package.json
- No CommonJS (`require`) — import/export only

## General
- No TypeScript — this is a local dev tool, keep it simple
- No transpilation — target Node LTS directly
- `const` by default; `let` only when reassignment is needed; never `var`

## Formatting
- 2-space indentation
- Single quotes for strings
- Trailing comma in multi-line arrays/objects
- Semicolons: yes

## Naming
- `camelCase` for variables and functions
- `PascalCase` for React components and classes
- `SCREAMING_SNAKE_CASE` for true constants (config values)

## Error Handling
- Always catch in async functions — use try/catch around DB/file ops
- Log errors with context: `console.error('[context]:', err.message)`
- Don't swallow errors silently

## Async
- `async/await` over `.then()` chains
- `Promise.all()` for parallel independent ops

## React (UI only)
- Functional components only — no class components
- Tailwind for all styling — no inline styles, no CSS modules
- Polling over WebSockets (2s interval) — keep it simple
