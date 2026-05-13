# ShadeSide Farms App — Claude Instructions

@CODEBASE.md
@FARMDOMAIN.md

## File editing
Always edit files in the main project directory: `/Users/Core/Documents/Jodhu/ShadeSideFarmsApp/`

Never edit files inside `.claude/worktrees/` or any worktree path. GitHub Desktop watches the main directory — changes in worktrees are invisible.

## Version number — mandatory on every change
`Index.html` line 425 contains the app build string, e.g. `2026-05-12 · r58`.

Increment `rN` and update the date on every session where any file is changed, no matter how small. Do this as the last step before reporting work complete. Do not skip this.

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

## Module map
`CODEBASE.md` is the live map of all modules. Update it whenever a new file is added, a module's purpose changes, or significant new variables or functions are introduced.

## Farm domain knowledge
`FARMDOMAIN.md` contains background on how the farm operates — animals, feed systems, land, financials. Consult it when designing features to avoid naive assumptions.
