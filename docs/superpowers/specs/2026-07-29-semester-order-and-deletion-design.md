# Semester Ordering and Permanent Deletion

## Goal

Let a treasurer correct the accounting order of semesters from the TUI and
permanently remove an accidental semester after typing its exact name. Keep
locked and transaction-bearing semesters protected from changes that could
alter or erase accounting history.

## Authoritative Order

The array order in `settings.semesters` remains the accounting sequence used
for semester carryover balances, comparison charts, filters, and selectors.
The application does not infer semester order from names or transaction dates.

This change corrects the current repository settings to:

```text
二上
二下
暑期輔導
三上
```

The correction changes only the order of the existing semester objects. It
preserves their names, statuses, lock state, current-semester selection, and
all other settings.

## Reordering Rules

The ledger exposes one operation that moves a configured semester one position
earlier or later. It returns validated settings without mutating the supplied
ledger state.

A move preserves every semester object and all unrelated settings. The ledger
rejects a move when:

- the semester does not exist;
- the requested direction would cross the start or end of the list;
- the selected semester is locked; or
- the adjacent semester involved in the swap is locked.

The last two rules ensure that no reorder changes a locked semester's
accounting position. A treasurer can unlock the affected semester without a
password, reorder the list, and lock it again.

Active and archived semesters share the same ordered list. The TUI shows both
so the stored sequence stays visible. Reordering an archived semester does not
reactivate it.

## Permanent Deletion Rules

Permanent deletion removes one semester object from `settings.semesters`.
Unlike archiving, adding the same name later creates a new option at the end of
the list.

The ledger requires the submitted confirmation text to match the semester name
exactly. It rejects deletion when:

- the confirmation does not match;
- the semester does not exist;
- the semester is the current semester;
- the semester is locked; or
- any transaction references the semester.

The transaction check applies regardless of transaction date, type, or filter.
Deletion never cascades to transactions and never moves them to another
semester. The user must remove or reassign those transactions through the
normal transaction workflow first. Both active and archived semesters can be
deleted when they pass these checks.

Failed reorder and deletion operations leave the supplied ledger state
unchanged.

## TUI Reordering Flow

The settings menu adds `調整學期順序`.

1. The user selects a semester from the complete ordered list.
2. Labels mark archived semesters as `已封存` and locked semesters as `已鎖定`.
3. The next selector offers the valid commands `往前移` and `往後移`.
4. Selecting a command saves the settings and returns to the ordered semester
   list, where the user can make another one-step move.

The selector omits a direction at a list boundary or when that move would swap
with a locked semester. Selecting a locked semester shows
`已鎖定學期不可調整順序，請先解鎖` instead of opening the direction selector.
`Esc` returns one step and does not save.

## TUI Deletion Flow

The settings menu adds `永久刪除學期`.

1. The user selects a semester from the complete list. Labels show active,
   archived, current, and locked state where applicable.
2. The TUI displays a permanent-deletion warning and
   `請輸入「<學期名稱>」確認永久刪除`.
3. The user types the name and submits it.
4. The ledger validates the confirmation and deletion rules before the TUI
   saves settings.
5. A successful save returns to the semester list and shows
   `學期已永久刪除`.

An incorrect name keeps the prompt open and shows `輸入名稱不符，未刪除學期`.
The TUI explains other failures with `目前學期不可刪除`,
`已鎖定學期不可刪除，請先解鎖`, or
`此學期仍有交易，請先移動或刪除交易`. `Esc` cancels without saving.

## Persistence and Consumers

Both actions use the repository's existing settings save path, including
source-conflict detection, backup creation, validation, and atomic file
replacement. The settings schema and transaction CSV format do not change.

The TUI refreshes its state after each successful save. The public report
contains no editing controls; it reads the updated array order on its next
build and uses that order for carryover and semester analytics.

## Tests

Ledger tests cover:

- moving active and archived semesters in both directions;
- preserving statuses, current semester, locks, and unrelated settings;
- rejecting unknown semesters, list-boundary moves, selected locked
  semesters, and swaps with locked neighbors;
- exact confirmation matching;
- refusing deletion of current, locked, and transaction-referenced semesters;
- deleting eligible active and archived semesters; and
- immutability after successful and failed operations.

TUI tests cover the menu actions, status labels, direction choices, repeated
one-step moves, cancellation at each step, confirmation mismatch, validation
messages, save conflicts, save failures, and post-save refresh behavior.

Existing carryover and analytics tests confirm that consumers follow the new
semester order. The full ledger, TUI, and web tests run alongside type checking
and production builds.

## Out of Scope

- Cascading deletion of transactions
- Moving transactions during semester deletion
- Renaming semesters
- Drag-and-drop or arbitrary-position reordering
- Permanent deletion of categories or officers
- Web-based settings controls
