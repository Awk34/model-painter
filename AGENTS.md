Never include Angular HTML inside TypeScript files with `template`. Always use a separate `.ng.html` with `templateUrl`.
Never include CSS inside TypeScript files with `styles`. Always use a separate `.css` (or `.scss`) file with `styleUrl`.

## State & Angular Reactivity
- This app uses `provideZoneChangeDetection({ eventCoalescing: true })`. Compute relative/incremental updates (e.g., quantity steppers, toggles) atomically inside `UserStateService` updaters against live signal state rather than `input().field + delta` in child components.
- When syncing an `input()` entity into local editable draft signals inside an `effect()`, gate resets on entity identity (`entity.id`) so sibling field updates do not overwrite unsaved user edits.

## Firestore & Storage Schema Invariants
- Store each user project as its own self-contained document at `/users/{userId}/projects/{projectId}` (embedding its `models`, `colorIds`, `notes`, and project/model `photos` metadata); keep non-project account state on `/users/{userId}`.
- Keep schema fields, integer coercions (`Math.trunc` for Firestore `is int` fields like `quantity`, `sizeBytes`, `imageIndex`), and quotas synchronized across `src/app/core/models/catalog.models.ts`, `src/app/core/config/user-limits.config.ts`, `firestore.rules`, and `storage.rules`.
