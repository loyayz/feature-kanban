# Kanban UI Usability Design

## Goal

Improve the board in both a normal browser and the Codex embedded iframe so that text is legible, the workflow fits without page-level horizontal scrolling, project selection does not consume a permanent left rail, and filtering controls have unambiguous state and repeatable behavior.

The approved presentation is a top project bar with a single row of six equal-width workflow columns. The board deliberately omits `initializing` and `completed` from its main surface.

## Confirmed diagnosis

The local API returned two active Codex cards while the Codex iframe displayed zero. Read-only CDP inspection showed that the iframe's AI tool filter was set to `claude`; direct requests from the same iframe returned both cards. Dispatching the existing tool-filter change to `all` immediately rendered both cards. Repeated refresh actions also issued new API requests.

The iframe and host injection therefore remained interactive. The visibility failure came from a small native select whose current filter was easy to miss, while clicking an already-selected filter or view correctly produced no state transition and looked like a dead control. The design replaces the ambiguous native select and makes active/loading states explicit. It does not change the Codex injection layer.

## Layout and components

`BoardPageComponent` becomes a vertically stacked workspace instead of a sidebar/workspace grid.

The top header contains the Feature Kanban identity, the current board title, and project buttons. Project buttons wrap onto another header line when needed rather than consuming permanent horizontal space. They keep the existing `all` and project selection behavior and existing server-provided counts. Those counts continue to represent all cards in the selected active/archive view across the full eight-stage protocol; the status line separately reports how many cards are present in the six displayed stages.

A control row contains three explicit AI tool buttons (`all`, `codex`, and `claude`), the existing active/archive view switch, and refresh. Every active filter uses a strong filled or raised state plus `aria-pressed`. Refresh exposes loading through a disabled state, an accessible busy label, and a short visual rotation so an accepted click is visible.

The board renders these stages in protocol order:

- `designing`
- `requirements_review`
- `implementation_planning`
- `implementing_and_reviewing`
- `finalizing_branch`
- `awaiting_integration`

The board uses a six-column CSS grid with `repeat(6, minmax(0, 1fr))`, hides page-level horizontal overflow, and permits vertical scrolling for card stacks. Columns and cards must allow their contents to shrink and wrap or truncate safely. A narrow viewport still shows all six stages in one row, accepting denser card content rather than reintroducing horizontal scrolling.

The typography floor rises from the current 8–11 px utility/body text to approximately 12–14 px. Primary card titles and page headings remain larger at approximately 14–20 px. Interactive controls use at least a 36 px target height where their layout permits it.

## State and data flow

The API, `BoardStore`, SSE refresh flow, project aggregation, archive state, detail drawer, and session navigation retain their existing semantics. The page continues loading all cards that match the selected project, tool, and archive filters. Presentation code distributes only cards whose stage is one of the six displayed stages. Initialization and completed cards therefore cannot be opened or archived from the main board while they remain in those hidden stages, which is the intended consequence of removing both columns.

The visible process count is calculated from the six displayed stages so the status line cannot claim that a hidden initializing or completed card is visible. Moving a card into `completed` removes it from the main board; moving a card from `initializing` into `designing` makes it appear. Stage motion remains unchanged between displayed stages. A transition across a hidden boundary appears or disappears without a cross-column animation because one endpoint has no rendered column. No server-side filtering or lifecycle-state mutation is added.

Selecting an already-active project, tool, or archive view remains a no-op, but the stronger active state makes that behavior explicit. Refresh is the explicit command for reloading an unchanged filter.

## Error handling and accessibility

The existing service error and retry behavior remains. The revised layout ensures the retry control is not obscured by the removed rail. Tool and view filters expose selected state through both styling and ARIA, project buttons expose the current selection, and keyboard focus treatment remains visible. Long project, branch, and card text uses wrapping or ellipsis without forcing container width.

## Verification

Production implementation comes first. Existing UI tests will then be updated to prove that the page renders exactly six workflow columns, omits initialization and completed labels, exposes top-level project and tool buttons, switches from `claude` back to `all` and renders matching cards, issues repeat refresh requests after prior loads complete, and still opens details and archives a card. The affected Angular tests, web build/typecheck, and the repository's complete `npm run check` quality gate will verify the result. Manual runtime inspection will confirm no page-level horizontal scrollbar at browser and Codex iframe widths and that real Codex cards are visible under the `all`/`codex` filters.

## Change-surface contract

Delivery is limited to the Angular board presentation and its tests. Expected existing production changes are the board page template, component presentation logic, board page styles, and focused column/card/detail typography styles if needed for a consistent readable floor. Existing UI tests will be modified; no server, repository, database, installer, launcher, lifecycle contract, Codex injection script, public API, permission boundary, transaction, retry, archive, session navigation, or SSE semantics will change. No production files are expected to be deleted and no new runtime module is expected.

Existing behaviors that must remain unchanged are project/tool/archive filtering semantics, card ordering within a displayed stage, detail and archive actions for displayed cards, motion between displayed stages, theme integration, error recovery, and Codex session navigation. The application continues to fetch and retain all eight protocol stages even though two are absent from the main board.

Runtime resource impact is limited to a smaller rendered column set and ordinary CSS layout; no shared capacity, persistent storage, network volume, or background-process increase is expected. Full browser/Codex visual verification and very narrow viewport behavior remain unverified until implementation.

The lower-intrusion alternative is to enlarge fonts and reduce the existing left rail and fixed column widths. It would preserve the current structure but would not satisfy the approved removal of the rail, the six-stage board, the explicit tool filters, or the requirement to eliminate page-level horizontal scrolling.
