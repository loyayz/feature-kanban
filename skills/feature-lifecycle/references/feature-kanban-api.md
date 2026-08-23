# Feature Kanban API reference

Use this reference only when reporting a `feature-lifecycle` flow. The service is a local non-blocking projection at `http://127.0.0.1:46171`; non-blocking errors never make the required lifecycle calls optional.

## Identity and call discipline

- Generate `cardId` and `sessionRecordId` as UUIDs and persist them in the lifecycle document before network I/O.
- Reusing the same `cardId` makes `POST /api/cards` idempotent server-side and does not overwrite the existing snapshot or archive state; the caller still discards the response.
- Issue `POST /api/cards` once, discard its response, and use full `PATCH` snapshots for every later stage or state transition regardless of the POST result.
- Project identity is the basename of the original repository root. Same-named directories intentionally merge.
- `projectPath` is the full absolute path of that original repository root, never the linked feature worktree. Lifecycle callers must send it on create even though the API remains optional for older clients.
- Card `title` is exactly `<feature-slug>` and excludes the lifecycle document's leading `YYYY-MM-DD-` date and `.md` extension.
- Use an exact 500ms timeout for every call and discard the response without parsing its body or status. A call failure is not recorded, retried, or allowed to block the lifecycle; do not start the service.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Validate product/port |
| POST | `/api/cards` | Idempotent create |
| PATCH | `/api/cards/{cardId}` | Replace mutable snapshot and activate session |
| GET | `/api/cards/{cardId}` | Read one card and all sessions |

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
    "aiTool": "codex"
  }
}
```

This create example is intentionally anonymous. When the runtime does not expose a real external session ID, omit `externalSessionId` from the `session` object entirely. The lifecycle document may use `unavailable` as a local human-readable placeholder, but API JSON must never send `externalSessionId` as `null`, an empty string, or `unavailable`.

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

The PATCH example shows identity supplementation after a real external session ID becomes available: retain the original `sessionRecordId` and add `externalSessionId` to that same session. If the ID is still unavailable, continue to omit the property completely; `null`, an empty string, and `unavailable` are invalid API values.

Optional session `jumpUri` accepts HTTPS or a `codex:` URI. Do not invent a real session ID or link when the runtime does not expose one.

After Stage 1 has produced and committed the design spec, every later full PATCH snapshot includes `specDocumentPath`. It must be the absolute path to that produced Markdown spec, not the lifecycle document, implementation plan, or an external requirement document. While development is isolated it may point into the feature worktree. Immediately before the final `completed` PATCH, rewrite it to the same repository-relative spec path under the original repository root so worktree cleanup cannot break preview.

The shipped Feature Lifecycle Skill sends `implementationSummary` on every Stage 4 full snapshot. Use a meaningful description of the current batch with at most 10 Unicode characters, such as `服务端存储` or `前端交互`; labels that only restate an ordinal such as `批次1` or `batch 2` are invalid. The API field remains optional only for backward compatibility with older callers.

## Completion archive

After successful base integration, report the `completed` / `integrated` snapshot. When that full snapshot is persisted, the server archives the card in the same transaction. A later successful non-`completed` full snapshot reactivates the card for a legal stage regression. Do not send a second archive request before or after worktree and branch cleanup.

The completed snapshot remains non-blocking: discard its response, do not record or retry a failure, and do not let its result alter Git cleanup or restore deleted resources.

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

## PowerShell fire-and-continue API call

```powershell
$body = $payload | ConvertTo-Json -Depth 6
Add-Type -AssemblyName System.Net.Http
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromMilliseconds(500)
$request = [System.Net.Http.HttpRequestMessage]::new(
  [System.Net.Http.HttpMethod]::Patch,
  "http://127.0.0.1:46171/api/cards/$cardId"
)
$request.Content = [System.Net.Http.StringContent]::new(
  $body,
  [System.Text.Encoding]::UTF8,
  'application/json'
)
try {
  $response = $client.SendAsync($request).GetAwaiter().GetResult()
  $response.Dispose()
} catch {
  # The local projection never blocks or changes lifecycle control flow.
} finally {
  $request.Dispose()
  $client.Dispose()
}
```

This is a direct REST call, not a CLI. Loading `System.Net.Http` explicitly keeps the example valid in a clean Windows PowerShell 5.1 process. Make exactly one call with the exact 500ms timeout for the corresponding transition, discard the response, ignore errors, and continue the lifecycle without logging or retrying that call. Use the runtime's equivalent millisecond timeout mechanism outside PowerShell.
