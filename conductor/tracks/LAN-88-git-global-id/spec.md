# Spec: git_global_id Schema + Population

## Problem Statement
Projects are currently identified by `repo_path` (absolute local filesystem path). If the same
repo is cloned at a different path or on a different machine, it gets a different identity.
The LC Cloud Collector (Track 017 Phase 3) needs a stable, cross-machine project key to route
writes to the correct project without requiring user-managed IDs.

## Requirements

- REQ-1: `projects` table gains a `git_global_id UUID` column (nullable, unique)
- REQ-2: `git_global_id` is derived deterministically from the git remote URL via UUID v5
  - Namespace: `6ba7b810-9dad-11d1-80b4-00c04fd430c8` (URL namespace, RFC 4122)
  - Name: the normalised git remote URL (lowercase, trailing `.git` stripped)
  - Same remote URL on any machine → same UUID
- REQ-3: If `git_remote` is null (no remote configured), `git_global_id` is null — no error
- REQ-4: `setup collection` populates `git_global_id` on project UPSERT
- REQ-5: Existing projects with a known `git_remote` are backfilled by a one-off migration script
- REQ-6: The collector `GET /project` endpoint returns `git_global_id`
- REQ-7: `.laneconductor.json` does NOT store `git_global_id` — always derived from remote URL
- REQ-8: SKILL.md `setup collection` section documents the new field

## Acceptance Criteria

- [ ] `ALTER TABLE` migration runs without error on the existing DB
- [ ] `SELECT git_global_id FROM projects WHERE id = 1` returns a valid UUID (not null) after backfill
- [ ] Running the derivation twice with the same remote URL produces the same UUID
- [ ] `collector GET /project` response includes `git_global_id`
- [ ] `setup collection` UPSERT includes `git_global_id` when `git_remote` is present

## API Contracts / Data Models

```sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS git_global_id UUID UNIQUE;
```

UUID v5 derivation (Node.js, no extra deps — use `crypto` built-in):
```js
import { createHash } from 'crypto';

function uuidV5(namespace, name) {
  // namespace bytes (URL namespace)
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const nameBytes = Buffer.from(name, 'utf8');
  const hash = createHash('sha1').update(ns).update(nameBytes).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // variant
  const h = hash.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

const URL_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function gitGlobalId(gitRemote) {
  if (!gitRemote) return null;
  const normalised = gitRemote.toLowerCase().replace(/\.git$/, '');
  return uuidV5(URL_NAMESPACE, normalised);
}
```

Collector `GET /project` response (extended):
```json
{
  "id": 1,
  "name": "laneconductor",
  "git_global_id": "xxxxxxxx-xxxx-5xxx-xxxx-xxxxxxxxxxxx",
  ...
}
```
