# Add Semester and Officer Settings Options

## Goal

Let a treasurer add semesters and officers from the TUI settings screen. The
screen already supports adding categories. All three option groups should use
the same interaction and persistence rules.

## User Flow

Press `s` from the overview to open `帳本設定`. The action menu contains:

- `目前學期`
- `預設經手人`
- `新增學期`
- `新增經手人`
- `新增分類`
- the existing archive actions

Choosing an add action opens a single-line text input. Enter submits the value.
Escape returns to the action menu without saving. The screen ignores input
while a save is pending.

Adding a semester or officer only adds it to the active option list. It does
not change `active_semester` or `default_officer`. The user can select the new
value through `目前學期` or `預設經手人` afterward.

## Settings Mutation

`SettingsScreen` maps each add action to an `OptionGroup`:

| Action | Option group |
| --- | --- |
| `新增學期` | `semesters` |
| `新增經手人` | `officers` |
| `新增分類` | `categories` |

Each action calls `addOption(state, group, value)` and persists the returned
settings through `onSave`. The ledger mutation reactivates an archived match
instead of appending a duplicate. Validation, canonicalization,
source-conflict detection, and atomic repository writes remain on the existing
path. The settings schema, JSON format, repository save flow, and persistence
format do not change.

If the value exists with `archived` status, `addOption` reactivates it. If an
active value already exists, the screen shows a group-specific message:

- `此學期已存在`
- `此經手人已存在`
- `此分類已存在`

Successful saves show `設定已儲存`. Source conflicts, validation failures, and
permission errors retain their current handling.

## Code Changes

Extend `apps/tui/src/screens/settings-screen.tsx` with the new actions, shared
text-input state, option-group mapping, and duplicate-message selection. Update
`packages/ledger/src/mutations.ts` so `addOption` reactivates archived matches
across all three `OptionGroup` values while it continues to reject active
duplicates. The mutation signature, repository save implementation, and
persistence format remain unchanged.

Update the Traditional Chinese operating instructions in `README.md` so the
settings command states that semesters, officers, and categories can be added.

## Tests

Add failing settings-screen tests before the TUI changes. Cover:

- adding a semester without changing the current semester;
- adding an officer without changing the default officer;
- reactivating archived semester and officer values;
- group-specific duplicate messages;
- Escape cancellation without writes;
- the existing add-category flow as a regression check.

Add ledger mutation tests before changing `addOption`. Cover active duplicate
rejection and archived-value reactivation for semesters, categories, and
officers. Verify that reactivation creates no duplicate, preserves the current
semester and default officer, and leaves the supplied `LedgerState` unchanged.

After the focused tests pass, run the full TUI and ledger suites, workspace
typecheck, production build and binary smoke, canonical data validation, and
`git diff --check`.

## Out of Scope

- Renaming options
- Deleting options
- Adding options while filling out a transaction form
- Automatically selecting a newly added semester or officer
- Changing the settings file format
