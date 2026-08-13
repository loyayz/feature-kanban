# Feature Kanban API reference

Use this reference only when reporting a `feature-lifecycle` flow. The service is a local optional projection at `http://127.0.0.1:46171`.

## Identity and retry

- Generate `cardId` and `sessionRecordId` as UUIDs and persist them in the lifecycle document before network I/O.
- `POST /api/cards` with the same `cardId` returns the existing card and does not overwrite its snapshot or archive state.
- A reused `cardId` with a different `projectName` or `lifecycleDocumentPath` returns `409` identity conflict. Stop reporting that flow until the local ID error is resolved.
- After a confirmed `200` or `201` create response, use full `PATCH` snapshots.
- Project identity is the basename of the original repository root. Same-named directories intentionally merge.
- `projectPath` is the full absolute path of that original repository root, never the linked feature worktree. Lifecycle callers must send it on create even though the API remains optional for older clients.
- Card `title` is exactly `<feature-slug>` and excludes the lifecycle document's leading `YYYY-MM-DD-` date and `.md` extension.
- On connection failure, record the error in the lifecycle document; do not retry in a loop and do not start the service.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Validate product/port |
| POST | `/api/cards` | Idempotent create |
| PATCH | `/api/cards/{cardId}` | Replace mutable snapshot and activate session |
| GET | `/api/cards/{cardId}` | Read one card and all sessions |
| PATCH | `/api/cards/{cardId}/archive` | User-facing archive state |

## Create payload

<!-- create-payload -->
```json
{
  "cardId": "6b6e7f6e-aafb-48af-9809-a78135db03a8",
  "projectName": "feature-kanban",
  "projectPath": "C:\\code\\feature-kanban",
  "title": "feature-lifecycle-kanban",
  "lifecycleDocumentPath": "C:\\code\\feature-kanban\\docs\\feature\\2026-08-12-feature-lifecycle-kanban.md",
  "stage": "initializing",
  "progress": {
    "stage": "initializing",
    "step": "ready"
  },
  "waitingForUser": false,
  "blocked": false,
  "aiTool": "codex",
  "branch": "feat/2026-08-12-feature-lifecycle-kanban",
  "session": {
    "sessionRecordId": "40ea2585-ee15-4098-a20a-a0d9d3329660",
    "aiTool": "codex",
    "externalSessionId": "019ff483-21a6-70c0-a246-205c1f7cad0d"
  }
}
```

## PATCH payload

Every PATCH sends all mutable fields. Omit `blockedReason` only when `blocked` is false. The session tool must match the card tool.

<!-- patch-payload -->
```json
{
  "stage": "implementing_and_reviewing",
  "progress": {
    "stage": "implementing_and_reviewing",
    "step": "validating",
    "implementationBatch": 2,
    "implementationSummary": "前端交互",
    "reviewRound": 1,
    "consecutiveCleanReviews": 0
  },
  "waitingForUser": false,
  "blocked": false,
  "aiTool": "codex",
  "branch": "feat/2026-08-12-feature-lifecycle-kanban",
  "specDocumentPath": "C:\\code\\feature-kanban\\.worktrees\\feature-lifecycle-kanban\\docs\\superpowers\\specs\\2026-08-12-feature-lifecycle-kanban-design.md",
  "session": {
    "sessionRecordId": "40ea2585-ee15-4098-a20a-a0d9d3329660",
    "aiTool": "codex",
    "externalSessionId": "019ff483-21a6-70c0-a246-205c1f7cad0d"
  }
}
```

Optional session `jumpUri` accepts HTTPS or a `codex:` URI. Do not invent a real session ID or link when the runtime does not expose one.

After Stage 1 has produced and committed the design spec, every later full PATCH snapshot includes `specDocumentPath`. It must be the absolute path to that produced Markdown spec, not the lifecycle document, implementation plan, or an external requirement document. While development is isolated it may point into the feature worktree. Immediately before the final `completed` PATCH, rewrite it to the same repository-relative spec path under the original repository root so worktree cleanup cannot break preview.

The shipped Feature Lifecycle Skill sends `implementationSummary` on every Stage 4 full snapshot. Use a meaningful description of the current batch with at most 10 Unicode characters, such as `服务端存储` or `前端交互`; labels that only restate an ordinal such as `批次1` or `batch 2` are invalid. The API field remains optional only for backward compatibility with older callers.

## Completion archive

After successful base integration, report the `completed` / `integrated` snapshot first. When the user chose integration and cleanup, remove the feature worktree and confirm `git branch -d <feature-branch>` succeeded before calling `PATCH /api/cards/{cardId}/archive` with:

```json
{ "archived": true }
```

An archive failure does not revert the completed lifecycle or restore deleted Git resources. Report the concise error to the user without recreating the deleted lifecycle document, retrying in a loop, or starting the service.

## Stage and progress mapping

| Stage | Allowed step values |
|---|---|
| `initializing` | `creating_worktree`, `creating_lifecycle_document`, `ready` |
| `designing` | `clarifying`, `comparing_approaches`, `writing_spec`, `complete` |
| `requirements_review` | `reviewing`, `updating_spec`, `complete` |
| `implementation_planning` | `planning`, `complete` |
| `implementing_and_reviewing` | `coding`, `validating`, `reviewing`, `fixing`; optional non-negative batch/review counters; the shipped Skill always includes a meaningful `implementationSummary` of at most 10 characters |
| `finalizing_branch` | `quality_gate`, `squashing`, `rebasing`, `verifying_final_state` |
| `awaiting_integration` | `waiting_for_user`, `integration_declined` |
| `completed` | `integrated` |

Stage regression is legal. The API applies the last valid PATCH that arrives and performs no Git checks.

## PowerShell API call

```powershell
$body = Get-Content -LiteralPath '.feature-kanban-payload.json' -Raw
Invoke-RestMethod -Method Patch `
  -Uri "http://127.0.0.1:46171/api/cards/$cardId" `
  -ContentType 'application/json' `
  -Body $body
```

This is a direct REST call, not a CLI. Bound the request timeout in the runtime's HTTP mechanism so a missing local service cannot stall the lifecycle.
