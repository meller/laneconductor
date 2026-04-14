# Spec: Track 1033: Worker Identity & Remote API Keys

## Problem Statement
When switching from `local-fs` or `local-api` to `remote-api`, workers must be authenticated to associate their activity with a specific user account. We need a streamlined "API Key" flow where a user registers on the remote dashboard, obtains a key, and provides it to the CLI/Worker to enable remote sync. Additionally, security must be enforced to prevent workers from accessing unauthorized directories in shared environments.

## Requirements
- **REQ-1: Zero-Auth local-fs**. The worker must function in `local-fs` mode without any credentials or account registration.
- **REQ-2: Remote API Key Registration**. The system must support a flow where workers use a long-lived API Key to authenticate with a remote collector.
- **REQ-3: CLI Key Capture**. `lc setup` and `lc config mode` must prompt for and validate a Remote API Key when `remote-api` is selected.
- **REQ-4: Worker Auth Prioritization**. The worker (`laneconductor.sync.mjs`) must use the configured API Key for all remote collector interactions.
- **REQ-5: Identity Linking**. The collector must link the worker's machine identity (hostname/fingerprint) to the user account associated with the API Key.
- **REQ-6: Implicit Project Membership**. Access to a project is granted based on knowledge of the `git_remote`. Anyone who configures a worker with the same remote automatically joins the project team. No explicit "Invite" or "Add to Project" flow is required for the dashboard itself.
- **REQ-7: Granular Worker Sharing**. A worker is owned by a `user_uid` (Owner).
    - **Private (Default)**: Only the Owner can use the worker.
    - **Team (Explicit)**: The Owner can explicitly grant access to specific project members. This is managed via the UI (Worker Kanban), allowing the owner to "Invite" teammates to use their compute resource.
    - **Public**: Any project member can use the worker (open pool).
- **REQ-8: Worker Path Isolation (Mandatory Security)**. Every worker must be strictly confined to its own designated folder (workspace). It must not be able to read or write files in sibling worker directories or parent directories outside the project root. This ensures that even when a teammate uses your worker, they cannot escape the project root.
- **REQ-9: Zero-Auth local-api**. Similar to `local-fs`, `local-api` mode (using a local collector instance) must remain functional without requiring an API Key.

## Data Model Changes (Prisma & Atlas)

The following changes must be applied to `prisma/schema.prisma` and deployed using Atlas migrations.

### 1. `api_keys` Table
Store persistent API keys for remote worker authentication.
```prisma
model api_keys {
  id           Int       @id @default(autoincrement())
  user_uid     String
  key_hash     String    @unique // SHA-256 hash of the API key
  key_prefix   String    // First 8 chars for display (e.g. lc_live_...)
  name         String?   // Friendly name (e.g. "Home Desktop")
  created_at   DateTime? @default(now()) @db.Timestamp(6)
  last_used_at DateTime? @db.Timestamp(6)
  users        users     @relation(fields: [user_uid], references: [uid], onDelete: Cascade)
}
```

### 2. `workers` Table Enhancements
Add visibility and link to user.
```prisma
model workers {
  // ... existing fields ...
  visibility     String?   @default("private") // 'private', 'team', 'public'
  user_uid       String?
  users          users?    @relation(fields: [user_uid], references: [uid])
  worker_permissions worker_permissions[]
}
```

### 3. `worker_permissions` Table
New table to track which users are allowed to use a specific worker when visibility is set to `team`.
```prisma
model worker_permissions {
  worker_id  Int
  user_uid   String
  added_at   DateTime @default(now()) @db.Timestamp(6)
  workers    workers  @relation(fields: [worker_id], references: [id], onDelete: Cascade)
  users      users    @relation(fields: [user_uid], references: [uid], onDelete: Cascade)

  @@id([worker_id, user_uid])
}
```

### 4. `users` Table Enhancements
```prisma
model users {
  // ... existing fields ...
  api_keys           api_keys[]
  workers            workers[]
  worker_permissions worker_permissions[]
}
```

## How Connectivity Works (Sharing Flow)
1.  **Identity**: Users are identified by API Keys. Projects are identified by `git_remote`.
2.  **Explicit Sharing (`team`)**: 
    - A user clicks on their worker in the UI.
    - They see a list of other `project_members` for that current project.
    - They can add/remove members to grant them "Worker Access".
    - This creates/deletes entries in the `worker_permissions` table.
3.  **Allowed User Resolution**:
    - If `worker.visibility = 'private'`: Targetable only by Owner.
    - If `worker.visibility = 'team'`: Targetable by Owner OR any user in `worker_permissions`.
    - If `worker.visibility = 'public'`: Targetable by any `project_member`.

## Security: Path Isolation Enforcement
The worker must enforce REQ-8 by:
1. Validating that `worktree_path` is always within `.worktrees/` inside the project root.
2. Checking for path traversal (`..`) in any path-related operations.
3. Using `realpath` to resolve and verify final paths before any filesystem access.

## Acceptance Criteria
- [ ] `local-fs` and `local-api` workers run successfully without any credentials.
- [ ] `lc setup` prompts for a key only when `remote-api` is chosen.
- [ ] Worker successfully registers and pulses a remote collector using an API Key.
- [ ] UI shows workers as "Shared" or "Private" based on owner settings.
- [ ] Multiple users sharing the same `git_remote` can see and "Claim" each other's `team` visibility workers.
- [ ] **Security**: A worker process attempting to access paths outside its assigned workspace results in an immediate failure/error (Isolation enforced).
