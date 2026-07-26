# Semester Carryover and Locking

## Goal

Keep one continuous class-fund balance across semesters while making each
semester view start from a visible opening balance. Let a treasurer lock a
finished semester against transaction changes and unlock it without a
password.

## Semester Order

The order of `settings.semesters` defines the accounting sequence. A semester
inherits the net balance of every semester listed before it. Adding a semester
appends it to this sequence. Reactivating an archived semester keeps its
existing position.

For example, with this order:

```text
三上
暑期輔導
```

`暑期輔導` starts with the ending balance from `三上`.

Changing `active_semester` keeps its current settings behavior. It does not
create a transaction, request a start date, lock either semester, or change the
semester sequence.

## Settings Format

Settings schema version 2 adds one field:

```json
{
  "schema_version": 2,
  "locked_semesters": ["三上"]
}
```

The field contains unique active semester values that also exist in
`semesters`. `active_semester` must not appear in `locked_semesters`.

The settings parser migrates version-1 data in memory by setting
`locked_semesters` to an empty list. The next settings save serializes version
2. The transaction CSV format does not change.

New and reactivated semesters start unlocked. Removing a semester from the
lock list unlocks it. Locking and unlocking require no password.

## Carryover Calculation

The ledger derives a semester's opening balance each time it builds a view:

1. Find the semester's index in `settings.semesters`.
2. Select transactions whose semester appears at a lower index.
3. Sum their income and expenses with the existing safe-integer calculation.

The first semester has an opening balance of zero. Positive, zero, and negative
opening balances are valid.

The result is display data, not a transaction. It does not affect overall or
filtered income, expenses, net balance, category summaries, search results, or
transaction counts. An edit to an earlier semester changes every later opening
balance on the next view calculation.

## Mutation Rules

A locked semester remains readable and filterable. The ledger rejects these
transaction mutations:

- adding a transaction assigned to a locked semester;
- editing a transaction that currently belongs to a locked semester;
- moving an unlocked transaction into a locked semester;
- deleting a transaction from a locked semester.

The ledger also rejects locking the current semester and setting a locked
semester as current. A treasurer must switch away from a semester before
locking it and must unlock a semester before making it current. A locked
semester must also be unlocked before it can be archived.

The mutation layer enforces these rules so the TUI, repository callers, and
future interfaces share the same behavior. Failed mutations leave the supplied
state unchanged.

## TUI

The settings action menu adds `學期鎖定狀態`. Its selector lists each semester
with `（未鎖定）` or `（已鎖定）`. Selecting a non-current semester toggles its
state and uses the existing settings save path. Selecting the current semester
shows `目前學期不可鎖定`. Save conflicts, validation failures, and permission
errors keep their current handling.

Locked semesters do not appear in the new-transaction semester selector, edit
destinations, or the `目前學期` selector. Opening edit or delete for a
transaction in a locked semester shows `此學期已鎖定，無法修改交易`.

When a user filters the overview to one semester, the transaction table shows
a blue, read-only row before the transaction rows:

```text
期初結餘  NT$4,000
```

The row is not part of keyboard selection, editing, deletion, search, or the
transaction count. Additional category, officer, type, or search filters do not
change the semester opening balance.

## Public Report

When the semester filter selects one semester, the website inserts the same
blue `期初結餘` row above the matching transaction rows. The row uses text and
layout as well as color to distinguish it, remains accessible to screen
readers, and does not claim a date, type, category, or officer.

The all-semester view does not show carryover rows because its transactions
already produce the complete balance. The website remains read-only, so lock
state does not hide historical transactions.

## Persistence and Recovery

Lock changes use the existing settings repository save, source-conflict check,
backup, and atomic replacement. Carryover needs no new persistence path.

Invalid version-2 settings report precise issues for duplicate lock values,
unknown or archived locked semesters, or a locked active semester. Version-1
migration must not hide unrelated validation errors.

## Tests

Ledger tests cover:

- version-1 migration and deterministic version-2 serialization;
- lock-list validation and immutability;
- carryover based on semester-list order;
- live recalculation after earlier transaction changes;
- positive, zero, and negative opening balances;
- unchanged totals, category summaries, row counts, and CSV format;
- rejection of every locked-semester mutation path;
- current-semester lock and activation restrictions.

TUI tests cover lock toggling, save errors, locked transaction actions, option
filtering, and a non-selectable opening row. Web unit and browser tests cover
the opening row, semester filters, accessible labeling, and the absence of a
carryover row in the all-semester view.

## Out of Scope

- Password-protected locks
- Automatic locking when changing semesters
- Start and end dates for semesters
- Stored balance snapshots or transfer transactions
- Renaming or reordering semesters
- Budgeting and financial forecasts
- Analytics chart changes, which have a separate design
