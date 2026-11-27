# ShadeSide Farms App — Claude Instructions

@CODEBASE.md
@FARMDOMAIN.md
@BUILD_BACKLOG.md

## File editing
Always edit files in the main project directory: `/Users/Core/Documents/Jodhu/ShadeSideFarmsApp/`

Never edit files inside `.claude/worktrees/` or any worktree path. GitHub Desktop watches the main directory — changes in worktrees are invisible.

## Version number — mandatory on every change
The app build lives in ONE place: `APP_BUILD` (a number) and `APP_BUILD_DATE` in the inline `<script>` block at the bottom of `Index.html`. The sidebar footer (`2026-11-20 · r84`) is filled from them automatically.

Increment `APP_BUILD` by 1 and update `APP_BUILD_DATE` on every session where any file is changed, no matter how small. Do this as the last step before reporting work complete. Do not skip this — `APP_BUILD` is also the cache-busting `?v=` on every script URL (static scripts in `Index.html` and lazy modules via `loadModule()` in `shared.js`). If it isn't bumped, browsers keep running stale cached JS after a deploy and new pages hang on "Loading...".

Never hardcode a `?v=` number on a script tag or in `loadModule()` — always use `APP_BUILD`.

## Clarify before coding
Never jump straight to implementation. Ask clarifying questions first to understand the exact behaviour wanted, edge cases, and how it connects to existing modules. This applies every time, without exception.

## Recommendations and alternatives
When proposing an approach, lead with the recommendation and explain why it is the best choice. Always offer at least one viable alternative, especially when designing modules, data structures, or significant features. Apply this to general ideas too, not just code.

If the user's proposed approach is not the best option, say so plainly. Don't validate a weak idea to avoid friction.

## Code quality
Code should be correct, robust, easy to read, and a pleasure to work with — not just functional. Prefer clear naming, logical structure, and simplicity over cleverness.

## Comments
Add comments throughout the codebase so the intent of each block is clear to a non-expert reader. Explain what a block is doing and why — not just restating what the code literally does.

## Nearby issues
If something worth fixing is noticed in a nearby file or function while working on a task, flag it and ask before touching it — unless it is directly blocking the current work, in which case fix it and note what was done.

## Tables — layout and readability
Design every table to fit a laptop-width screen (roughly 1000px of table space) without sideways scrolling, and check it in the preview at that width (`resize_window` 1280×800) before calling it done.
- **Widths follow content.** Give text-heavy columns (descriptions, "used for", notes) the room via `min-width` on their `<th>`; keep short values (packs, amounts, dates, stock) on one line with `white-space:nowrap` so their columns shrink to fit.
- **One font per table.** Each cell's lines share the cell's own font and size — no mixing small, coloured or monospace sub-lines into one cell. Put each fact on its own line (`<div>` per line) rather than shrinking it.
- **One kind of information per column.** Don't tuck unrelated facts into another column (e.g. safety warnings inside Withdrawal); give them their own column, labelled clearly. Label every value that could be ambiguous ("Meat: 14 d", "Milk: 4 d").
- **Save width where it's cheap.** Stack row action buttons vertically (`display:flex;flex-direction:column;gap:4px`), split two-part values onto two lines (e.g. "50 ml" / "per Bottle"), let long headers wrap (or break with `&shy;`), and use the `.tbl-compact` class for tighter padding on tables with many columns.
- Reference example: Setup › Medicines (`renderMedSetupTable()` in `health_meds.js`). The general table patterns (render skeleton, sorting, empty/loading states) are in the `tables` skill.

## Module map
`CODEBASE.md` is the live map of all modules. Update it whenever a new file is added, a module's purpose changes, or significant new variables or functions are introduced.

## Farm domain knowledge
`FARMDOMAIN.md` contains background on how the farm operates — animals, feed systems, land, financials. Consult it when designing features to avoid naive assumptions.

## Build backlog
`BUILD_BACKLOG.md` tracks confirmed pending, resolved, and archived items from ongoing codebase review. Check it before starting new work — it may already contain a verified decision or scope note relevant to the task. Update it (add/remove/check off items) as work completes or new gaps are confirmed.
