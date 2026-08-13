# Codex Navigation and Archived Cards Regression Design

## Goal

Restore reliable interaction with the Feature Kanban board inside Codex, make every native Codex sidebar activation close the owned board panel, and make the archived view show completed archived flows again. The implementation must not intercept, replace, or alter Codex navigation, focus, routing, selection, or click behavior.

## Confirmed diagnosis

Read-only CDP inspection of the running managed Codex renderer showed that a real mouse event delivered to a project button inside the Feature Kanban iframe changed the Angular project selection and issued the expected view update. The Angular project filter and API contract are therefore functional. The remaining embedded-only interaction failures are at the host integration boundary: the injection script infers native sidebar activation from `blur` events on the owned entry and iframe, then inspects `document.activeElement` after a timer. Codex sidebar controls can focus at different points in their click lifecycle, so this indirect inference can either react to an iframe focus transition or miss a native sidebar click.

The archived-card regression is deterministic. The previous usability change intentionally reduced the rendered board from all lifecycle stages to six active workflow stages and filtered `completed` out of `cardsFor` and `visibleCount`. Lifecycle cleanup archives cards after they reach `completed`, so the API can return archived rows that presentation code never renders.

## Considered approaches

The recommended approach is explicit ownership-boundary handling. Listen for click events at the Codex document level, detect whether the composed target belongs to the current native sidebar, and hide only the Feature Kanban-owned panel. The listener does not cancel, stop, synthesize, or redirect the Codex event. Inside Angular, select the displayed stage set from the current archive view: the six active stages for the active view and only `completed` for the archived view. This directly addresses both root causes while preserving Codex and server semantics.

A smaller patch would add `completed` to the existing six columns and keep the blur inference. It would restore some archived cards but would reintroduce a permanent seventh active column and leave both embedded interaction reports unresolved.

A heavier approach would observe Codex route or selection mutations and derive panel visibility from native application state. That would couple Feature Kanban to more private Codex DOM and routing details, expand compatibility risk, and violate the requirement not to change or emulate Codex mechanisms.

## Host integration behavior

The injected entry remains a normal owned button placed after the native Plugins entry. Clicking it continues to toggle the owned panel. A capture-phase document click observer examines the event target without modifying the event. When the board is active and the click occurred inside the currently mounted native sidebar navigation but outside the Feature Kanban entry, the observer calls the existing owned `setActive(false)` path. Native Codex handlers then receive and process the original event normally.

Clicks inside the cross-origin Feature Kanban iframe never reach the Codex document observer and therefore cannot be interpreted as sidebar navigation. The iframe and entry no longer use `blur` to infer navigation. Remount and dispose manage the new observer with the same lifetime as the existing message and mutation observers, preventing duplicate listeners after reinjection.

The implementation must not call `preventDefault`, `stopPropagation`, `stopImmediatePropagation`, native element `.click()`, `electronBridge`, or a Codex route API for panel closing. Existing session-opening behavior remains unchanged because it is a separate user-requested navigation action initiated from a card detail.

## Board presentation and data flow

`BoardStore` retains its current project, tool, and archive filters and continues requesting `archived=true` when the user selects 已归档. No API, repository, database, archive mutation, SSE, project-count, or lifecycle-contract behavior changes.

The active view renders the existing six stages in their current order: `designing`, `requirements_review`, `implementation_planning`, `implementing_and_reviewing`, `finalizing_branch`, and `awaiting_integration`.

The archived view renders one full-width `completed` column labelled 已完成. Only API-returned cards whose `archived` state matches the selected view and whose stage is `completed` appear there. Archived cards from non-completed stages remain intentionally hidden, matching the confirmed requirement that 已归档 is a history of ended flows rather than a general archive browser.

The visible count uses the stage set for the selected view. Project badges continue using server-provided archive totals and may therefore include non-completed archived rows; changing those aggregates would require server semantics outside this fix. The archived board uses an explicit single-column layout instead of stretching the existing six-column rule implicitly.

## Error handling and compatibility

The existing service-unavailable message, retry action, loading state, filter no-op behavior, card detail, archive/unarchive action, and session navigation remain unchanged. If Codex changes its sidebar markers, the existing sidebar discovery can fail to mount the entry; this fix does not broaden or emulate Codex internals. The click observer always resolves the live sidebar through the same supported-by-this-integration selectors used for mounting.

The local service stopped accepting connections during diagnosis after the initial lifecycle card was created. That prevents a final live archived-data smoke test unless the managed service becomes available again, but it does not change the source-level root cause or automated verification plan.

## Verification

Production implementation precedes test changes. Focused injection tests will prove that a non-owned native sidebar click closes the panel, a Feature Kanban entry click still toggles it, iframe focus/blur no longer controls visibility, the native click is not canceled, and dispose removes owned behavior. Angular board tests will prove that the active view still has six columns, selecting 已归档 requests `archived=true`, the archived view renders only one completed column and its completed card, and non-completed archived cards remain hidden.

Affected test commands are `npm run test:inject` and `npm run test:web`. The user-defined final quality gate is limited to `npm run typecheck` and `npm test`; Windows staging, package verification, and installer construction are explicitly excluded. A live CDP smoke test will be repeated if the managed Codex iframe and local service are available; it must show an iframe project click changing the selected project and a native sidebar click closing the panel without preventing Codex selection.

## Change-surface contract

Delivery is limited to the Feature Kanban Codex injection script, its injection tests, the Angular board page presentation/component styles, and its focused tests. Expected existing production modifications are `inject/feature-kanban.user.js`, `web/src/app/board/board-page.component.ts`, `web/src/app/board/board-page.component.html` only if the template needs the selected stage set, and `web/src/app/board/board-page.component.css`. Existing tests in `test/inject/feature-kanban-injection.test.ts` and `web/src/app/board/board-page.component.spec.ts` will be updated. No production file will be deleted and no new runtime module is expected.

The host control-flow change replaces focus inference with a passive observation of native sidebar clicks. Its only side effect is hiding the owned panel and restoring owned visual selection state. It does not alter native Codex DOM attributes/classes, event delivery, route state, focus, sidebar selection, or renderer APIs. The board control-flow change selects a one-stage projection when `archived=true`; it does not change lifecycle or archive data semantics.

Protected behavior includes Codex native click/navigation/focus/selection mechanisms, the injection entry position and toggle, native-selection visual restoration, renderer remounting, cross-origin challenge validation, session opening, all board filters and API requests, archive/unarchive mutations, project counts, active six-stage layout, detail presentation, SSE refresh, persistence, and the fixed lifecycle protocol.

Runtime impact is one passive document click listener per injected renderer and a smaller one-column DOM in archived view. There is no persistent storage, network volume, process, permission, transaction, retry, compensation, or shared-capacity change. Real Codex behavior after future private DOM changes and live archived-data display remain runtime compatibility checks rather than guaranteed public integration contracts.

The lower-intrusion alternative is to restore only a completed column. It would leave the unreliable focus inference in place, retain the reported failure to close from some native sidebar interactions, and would not protect iframe interaction from host focus timing; its fidelity loss is unacceptable for the confirmed request.

## Authorization

On 2026-08-13 the user explicitly authorized the recommended host and board control-flow changes after being shown their scope and impacts, with two constraints: Feature Kanban must not change Codex's own mechanisms, and 已归档 must show only flows that have ended. This document incorporates those constraints; any later need to intercept Codex events, change native navigation, expose non-completed archived cards, or modify server/archive semantics invalidates this authorization.
