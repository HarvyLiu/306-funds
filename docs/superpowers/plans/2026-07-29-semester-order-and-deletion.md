# Semester Ordering and Permanent Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe TUI controls for one-step semester reordering and exact-name-confirmed permanent deletion, then correct the live semester order to `二上`, `二下`, `暑期輔導`, `三上`.

**Architecture:** Add immutable domain operations to `packages/ledger/src/mutations.ts` so every caller receives the same lock, boundary, reference, and confirmation checks. Extend the existing Ink settings state machine with focused reorder and deletion substates while keeping repository persistence and conflict handling unchanged. The public report needs no component change because its carryover and analytics models already consume `settings.semesters` order.

**Tech Stack:** TypeScript, Zod-backed ledger validation, React 19, Ink, Vitest, Astro, Playwright

---

## File Map

- Modify `packages/ledger/src/types.ts`: define the supported semester move directions.
- Modify `packages/ledger/src/mutations.ts`: implement immutable reorder and permanent-delete operations.
- Modify `packages/ledger/test/mutations.test.ts`: cover domain success, validation, and immutability.
- Modify `apps/tui/src/screens/settings-screen.tsx`: add the reorder and delete interaction states and messages.
- Modify `apps/tui/src/app.tsx`: keep the settings screen open after a successful reorder or permanent deletion.
- Modify `apps/tui/test/settings-screen.test.tsx`: cover selectors, confirmation, persistence, errors, and repeated moves.
- Modify `README.md`: explain the new settings actions and safety rules.
- Modify `data/settings.json` only after feature integration: correct the user's live order without staging unrelated live-data changes.

## Working Tree Safety

The main checkout already contains user-owned changes in `data/settings.json`,
`.superpowers/`, and `ledger-paste.txt`. Create an isolated worktree before Task
1. Do not copy, stage, commit, or remove those changes. Complete and integrate
the reusable feature first. Apply the four-semester live-data correction in the
main checkout only during Task 6.

### Task 1: Ledger Semester Reordering

**Files:**
- Modify: `packages/ledger/src/types.ts`
- Modify: `packages/ledger/src/mutations.ts`
- Test: `packages/ledger/test/mutations.test.ts`

- [ ] **Step 1: Write failing reorder tests**

Add `moveSemester` to the import from `../src/index.js`. Add a fixture with an
archived middle semester and tests equivalent to the following:

```ts
function reorderState(): LedgerState {
  return {
    settings: {
      ...structuredClone(validSettings),
      semesters: [
        {value: '第一學期', status: 'active'},
        {value: '已封存學期', status: 'archived'},
        {value: '第二學期', status: 'active'},
      ],
    },
    transactions: [],
  };
}

describe('semester ordering', () => {
  test('moves active and archived semesters one position in either direction', () => {
    const state = reorderState();
    const before = structuredClone(state);

    const earlier = moveSemester(state, '第二學期', 'earlier');
    const later = moveSemester(state, '已封存學期', 'later');

    expect(earlier.semesters.map(({value}) => value)).toEqual([
      '第一學期',
      '第二學期',
      '已封存學期',
    ]);
    expect(later.semesters.map(({value}) => value)).toEqual([
      '第一學期',
      '已封存學期',
      '第二學期',
    ]);
    expect(earlier.semesters[2]).toEqual({
      value: '已封存學期',
      status: 'archived',
    });
    expect(state).toEqual(before);
    expect(earlier).not.toBe(state.settings);
    expect(earlier.semesters).not.toBe(state.settings.semesters);
  });

  test.each([
    ['第一學期', 'earlier'],
    ['第二學期', 'later'],
  ] as const)('rejects moving %s beyond the list with %s', (value, direction) => {
    const error = validationError(() =>
      moveSemester(reorderState(), value, direction),
    );

    expect(error.issues).toContainEqual({
      source: 'settings',
      field: 'semesters',
      message: 'Semester cannot move beyond configured order',
    });
  });

  test('rejects a locked selected semester and a swap with a locked neighbor', () => {
    const selectedLocked = reorderState();
    selectedLocked.settings.locked_semesters = ['第二學期'];
    const selectedBefore = structuredClone(selectedLocked);
    const neighborLocked = reorderState();
    neighborLocked.settings.locked_semesters = ['第二學期'];
    const neighborBefore = structuredClone(neighborLocked);

    for (const run of [
      () => moveSemester(selectedLocked, '第二學期', 'earlier'),
      () => moveSemester(neighborLocked, '已封存學期', 'later'),
    ]) {
      const error = validationError(run);
      expect(error.issues).toContainEqual({
        source: 'settings',
        field: 'locked_semesters',
        message: 'Locked semester cannot be reordered',
      });
    }

    expect(selectedLocked).toEqual(selectedBefore);
    expect(neighborLocked).toEqual(neighborBefore);
  });

  test('rejects unknown semesters and unsupported runtime directions', () => {
    expect(
      validationError(() =>
        moveSemester(reorderState(), '不存在', 'earlier'),
      ).issues,
    ).toContainEqual({
      source: 'settings',
      field: 'semesters',
      message: 'Semester is not configured',
    });

    expect(
      validationError(() =>
        moveSemester(reorderState(), '第二學期', 'sideways' as 'earlier'),
      ).issues,
    ).toContainEqual({
      source: 'settings',
      field: 'direction',
      message: 'Semester move direction is not supported',
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
npm test -w @class-fund/ledger -- test/mutations.test.ts
```

Expected: FAIL because `moveSemester` is not exported.

- [ ] **Step 3: Define the direction type and implement the reorder operation**

Add this exported type to `packages/ledger/src/types.ts`:

```ts
export type SemesterMoveDirection = 'earlier' | 'later';
```

Import `SemesterMoveDirection` in `packages/ledger/src/mutations.ts`, then add:

```ts
function requireSemesterMoveDirection(
  value: SemesterMoveDirection,
): SemesterMoveDirection {
  if (value !== 'earlier' && value !== 'later') {
    settingsFailure('direction', 'Semester move direction is not supported');
  }
  return value;
}

export function moveSemester(
  state: LedgerState,
  value: string,
  direction: SemesterMoveDirection,
): LedgerSettings {
  const current = canonicalizeState(state);
  const settings = current.settings;
  const checkedDirection = requireSemesterMoveDirection(direction);
  const index = settings.semesters.findIndex(
    (semester) => semester.value === value,
  );

  if (index === -1) {
    settingsFailure('semesters', 'Semester is not configured');
  }

  const targetIndex = index + (checkedDirection === 'earlier' ? -1 : 1);
  if (targetIndex < 0 || targetIndex >= settings.semesters.length) {
    settingsFailure('semesters', 'Semester cannot move beyond configured order');
  }

  const adjacent = settings.semesters[targetIndex]!;
  if (
    isSemesterLocked(settings, value) ||
    isSemesterLocked(settings, adjacent.value)
  ) {
    settingsFailure(
      'locked_semesters',
      'Locked semester cannot be reordered',
    );
  }

  const selected = settings.semesters[index]!;
  settings.semesters[index] = adjacent;
  settings.semesters[targetIndex] = selected;
  return validateSettingsValue(settings);
}
```

Keep the operation in `mutations.ts`; `packages/ledger/src/index.ts` already
re-exports that module.

- [ ] **Step 4: Run the focused ledger tests**

Run:

```bash
npm test -w @class-fund/ledger -- test/mutations.test.ts
```

Expected: PASS, including the new semester-ordering cases.

- [ ] **Step 5: Commit the reorder domain change**

```bash
git add packages/ledger/src/types.ts packages/ledger/src/mutations.ts packages/ledger/test/mutations.test.ts
git commit -m "feat: reorder configured semesters"
```

### Task 2: Ledger Permanent Semester Deletion

**Files:**
- Modify: `packages/ledger/src/mutations.ts`
- Test: `packages/ledger/test/mutations.test.ts`

- [ ] **Step 1: Write failing permanent-deletion tests**

Add `deleteSemester` to the test import and add:

```ts
describe('permanent semester deletion', () => {
  test.each([
    ['第二學期', 'active'],
    ['已封存學期', 'archived'],
  ] as const)('deletes an eligible %s semester', (value, status) => {
    const state = reorderState();
    const before = structuredClone(state);

    const next = deleteSemester(state, value, value);

    expect(next.semesters).not.toContainEqual({value, status});
    expect(state).toEqual(before);
    expect(next).not.toBe(state.settings);
    expect(next.semesters).not.toBe(state.settings.semesters);
  });

  test('requires an exact confirmation without trimming or normalization', () => {
    for (const confirmation of ['第二學期 ', ' 第二學期', '第二学期']) {
      const state = reorderState();
      const before = structuredClone(state);
      const error = validationError(() =>
        deleteSemester(state, '第二學期', confirmation),
      );

      expect(error.issues).toContainEqual({
        source: 'settings',
        field: 'confirmation',
        message: 'Semester confirmation does not match',
      });
      expect(state).toEqual(before);
    }
  });

  test('refuses to delete the current semester', () => {
    const error = validationError(() =>
      deleteSemester(reorderState(), '第一學期', '第一學期'),
    );
    expect(error.issues).toContainEqual({
      source: 'settings',
      field: 'active_semester',
      message: 'Current semester cannot be deleted',
    });
  });

  test('refuses to delete a locked semester', () => {
    const state = reorderState();
    state.settings.locked_semesters = ['第二學期'];
    const error = validationError(() =>
      deleteSemester(state, '第二學期', '第二學期'),
    );
    expect(error.issues).toContainEqual({
      source: 'settings',
      field: 'locked_semesters',
      message: 'Locked semester cannot be deleted',
    });
  });

  test('refuses to delete a semester referenced by any transaction', () => {
    const state = reorderState();
    state.transactions = [
      {...structuredClone(openingIncome), semester: '第二學期'},
    ];
    const before = structuredClone(state);
    const error = validationError(() =>
      deleteSemester(state, '第二學期', '第二學期'),
    );

    expect(error.issues).toContainEqual({
      source: 'transactions',
      row: 2,
      field: 'semester',
      message: 'Referenced semester cannot be deleted',
    });
    expect(state).toEqual(before);
  });

  test('refuses to delete an unknown semester', () => {
    const error = validationError(() =>
      deleteSemester(reorderState(), '不存在', '不存在'),
    );
    expect(error.issues).toContainEqual({
      source: 'settings',
      field: 'semesters',
      message: 'Semester is not configured',
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
npm test -w @class-fund/ledger -- test/mutations.test.ts
```

Expected: FAIL because `deleteSemester` is not exported.

- [ ] **Step 3: Implement permanent deletion in the ledger domain**

Add this function to `packages/ledger/src/mutations.ts`:

```ts
export function deleteSemester(
  state: LedgerState,
  value: string,
  confirmation: string,
): LedgerSettings {
  if (confirmation !== value) {
    settingsFailure('confirmation', 'Semester confirmation does not match');
  }

  const current = canonicalizeState(state);
  const settings = current.settings;
  const index = settings.semesters.findIndex(
    (semester) => semester.value === value,
  );

  if (index === -1) {
    settingsFailure('semesters', 'Semester is not configured');
  }
  if (settings.active_semester === value) {
    settingsFailure('active_semester', 'Current semester cannot be deleted');
  }
  if (isSemesterLocked(settings, value)) {
    settingsFailure('locked_semesters', 'Locked semester cannot be deleted');
  }

  const referenceIndex = current.transactions.findIndex(
    (transaction) => transaction.semester === value,
  );
  if (referenceIndex !== -1) {
    transactionFailure(
      'semester',
      'Referenced semester cannot be deleted',
      referenceIndex + 2,
    );
  }

  settings.semesters.splice(index, 1);
  return validateSettingsValue(settings);
}
```

Do not reuse `archiveOption`; permanent deletion has different confirmation
and reference messages and removes the object instead of changing its status.

- [ ] **Step 4: Run ledger tests and type checking**

Run:

```bash
npm test -w @class-fund/ledger -- test/mutations.test.ts
npm run typecheck -w @class-fund/ledger
```

Expected: both commands PASS.

- [ ] **Step 5: Commit permanent deletion**

```bash
git add packages/ledger/src/mutations.ts packages/ledger/test/mutations.test.ts
git commit -m "feat: permanently delete empty semesters"
```

### Task 3: TUI Semester Reordering Flow

**Files:**
- Modify: `apps/tui/src/screens/settings-screen.tsx`
- Modify: `apps/tui/src/app.tsx`
- Test: `apps/tui/test/settings-screen.test.tsx`

- [ ] **Step 1: Add test helpers and failing reorder interaction tests**

Add a helper that can choose menu items beyond the numeric shortcuts:

```ts
async function chooseIndex(
  stdin: {write(data: string): void},
  oneBasedIndex: number,
): Promise<void> {
  for (let index = 1; index < oneBasedIndex; index += 1) {
    stdin.write('j');
    await nextRender();
  }
  stdin.write('\r');
  await nextRender();
}
```

Append `調整學期順序` as the tenth settings action so existing numeric action
tests keep their current positions. Add tests equivalent to:

```tsx
it('shows every semester in stored order with archived and locked labels', async () => {
  const managed = structuredClone(settings);
  managed.semesters.splice(1, 0, {
    value: '已封存學期',
    status: 'archived',
  });
  managed.locked_semesters = ['第二學期'];
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings: managed, transactions}}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await chooseIndex(stdin, 10);
  const frame = lastFrame()!;
  expect(frame.indexOf('第一學期')).toBeLessThan(frame.indexOf('已封存學期'));
  expect(frame.indexOf('已封存學期')).toBeLessThan(frame.indexOf('第二學期'));
  expect(frame).toContain('已封存學期（已封存）');
  expect(frame).toContain('第二學期（啟用中／已鎖定）');
});

it('offers valid directions and persists a one-step move', async () => {
  const managed = structuredClone(settings);
  managed.semesters.push({value: '第三學期', status: 'active'});
  const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings: managed, transactions}}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );

  await chooseIndex(stdin, 10);
  await choose(stdin, '2');
  expect(lastFrame()).toContain('往前移');
  expect(lastFrame()).toContain('往後移');
  await choose(stdin, '1');

  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]![0].semesters.map(({value}) => value)).toEqual([
    '第二學期',
    '第一學期',
    '第三學期',
  ]);
});

it('does not open directions for a locked semester', async () => {
  const managed = structuredClone(settings);
  managed.locked_semesters = ['第二學期'];
  const onSave = vi.fn();
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings: managed, transactions}}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );

  await chooseIndex(stdin, 10);
  await choose(stdin, '2');
  expect(lastFrame()).toContain('已鎖定學期不可調整順序，請先解鎖');
  expect(lastFrame()).not.toContain('往前移');
  expect(onSave).not.toHaveBeenCalled();
});

it('omits moves across boundaries and locked neighbors', async () => {
  const managed = structuredClone(settings);
  managed.semesters.push({value: '第三學期', status: 'active'});
  managed.locked_semesters = ['第二學期'];
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings: managed, transactions}}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await chooseIndex(stdin, 10);
  await choose(stdin, '1');
  expect(lastFrame()).not.toContain('往前移');
  expect(lastFrame()).not.toContain('往後移');
});
```

Add one stateful harness test that updates its `state` prop from `onSave`, makes
two one-step moves without returning to the overview, and asserts the second
save receives the order produced by the first save. Add an `Esc` test that
backs out from the direction selector to the semester list without saving.

- [ ] **Step 2: Run the TUI test and verify the red state**

Run:

```bash
npm exec -w @class-fund/tui -- vitest run test/settings-screen.test.tsx
```

Expected: FAIL because the action and interaction state do not exist.

- [ ] **Step 3: Add reorder state, labels, and persistence behavior**

In `settings-screen.tsx`:

1. Import `moveSemester` and `SemesterMoveDirection`.
2. Add `'reorder-semester'` to `Action` and append
   `{label: '調整學期順序', value: 'reorder-semester'}` to `actions`.
3. Add `selectedSemester: string | null` state.
4. Extend `SettingsScreenProps.onSaved` with an optional second argument:

```ts
export interface SettingsSavedOptions {
  stayOpen?: boolean;
}

export interface SettingsScreenProps {
  state: LedgerState;
  onSave(settings: LedgerSettings): Promise<void>;
  onCancel(): void;
  onSaved?(
    settings: LedgerSettings,
    options?: SettingsSavedOptions,
  ): void;
}
```

5. Change `persist` to return `Promise<boolean>` and accept:

```ts
interface PersistOptions {
  stayOpen?: boolean;
  successMessage?: string;
}
```

On success, use `successMessage ?? '設定已儲存'`. Call `onSaved(next)` for
normal actions and `onSaved(next, {stayOpen: true})` when `stayOpen` is true.
Return `true` only after `onSave` resolves; return `false` after conflicts,
validation errors, generic errors, or duplicate submissions.

Add these focused helpers:

```ts
function semesterManagementLabel(
  settings: LedgerSettings,
  option: LedgerOption,
): string {
  const statuses: string[] = [];
  if (option.status === 'active') statuses.push('啟用中');
  else statuses.push('已封存');
  if (option.value === settings.active_semester) statuses.push('目前學期');
  if (isSemesterLocked(settings, option.value)) statuses.push('已鎖定');
  return statuses.length === 0
    ? option.value
    : `${option.value}（${statuses.join('／')}）`;
}

function semesterMoveItems(
  settings: LedgerSettings,
  value: string,
): Array<{label: string; value: SemesterMoveDirection}> {
  const index = settings.semesters.findIndex(
    (semester) => semester.value === value,
  );
  if (index === -1 || isSemesterLocked(settings, value)) return [];

  const items: Array<{label: string; value: SemesterMoveDirection}> = [];
  const previous = settings.semesters[index - 1];
  const next = settings.semesters[index + 1];
  if (previous !== undefined && !isSemesterLocked(settings, previous.value)) {
    items.push({label: '往前移', value: 'earlier'});
  }
  if (next !== undefined && !isSemesterLocked(settings, next.value)) {
    items.push({label: '往後移', value: 'later'});
  }
  return items;
}
```

When `action === 'reorder-semester'` and no semester is selected, render every
semester with `semesterManagementLabel`. Reject a locked selection with
`已鎖定學期不可調整順序，請先解鎖`. Otherwise store its value and render the
direction items. If no direction exists, render `此學期目前沒有可移動的位置`.

Submit a direction through:

```ts
async function proposeSemesterMove(
  direction: SemesterMoveDirection,
): Promise<void> {
  if (selectedSemester === null) return;
  try {
    const next = moveSemester(state, selectedSemester, direction);
    const saved = await persist(next, 'reorder-semester', {
      stayOpen: true,
      successMessage: '學期順序已儲存',
    });
    if (saved) setSelectedSemester(null);
  } catch (error) {
    setMessage(
      error instanceof LedgerValidationError
        ? validationMessage(error, 'reorder-semester')
        : '設定內容無效，請檢查選擇或輸入值',
    );
  }
}
```

Update the Escape handler so it clears `selectedSemester` first, then returns
to the settings action menu on the next Escape.

In `apps/tui/src/app.tsx`, keep management actions open:

```tsx
onSaved={(_settings, options) => {
  if (options?.stayOpen !== true) setScreen({name: 'overview'});
}}
```

- [ ] **Step 4: Add reorder validation messages**

Extend `validationMessage` with:

```ts
if (messages.includes('Locked semester cannot be reordered')) {
  return '已鎖定學期不可調整順序，請先解鎖';
}
if (messages.includes('Semester cannot move beyond configured order')) {
  return '此學期目前沒有可移動的位置';
}
```

Treat `學期順序已儲存` as a green success message along with `設定已儲存`.

- [ ] **Step 5: Run TUI tests and type checking**

Run:

```bash
npm exec -w @class-fund/tui -- vitest run test/settings-screen.test.tsx
npm run typecheck -w @class-fund/tui
```

Expected: both commands PASS.

- [ ] **Step 6: Commit the TUI reorder flow**

```bash
git add apps/tui/src/screens/settings-screen.tsx apps/tui/src/app.tsx apps/tui/test/settings-screen.test.tsx
git commit -m "feat: reorder semesters from tui settings"
```

### Task 4: TUI Permanent Deletion Flow

**Files:**
- Modify: `apps/tui/src/screens/settings-screen.tsx`
- Test: `apps/tui/test/settings-screen.test.tsx`

- [ ] **Step 1: Write failing deletion interaction tests**

Append `永久刪除學期` as the eleventh settings action. Add tests equivalent
to:

```tsx
it('shows every semester and asks for the exact selected name', async () => {
  const managed = structuredClone(settings);
  managed.semesters.push({value: '已封存學期', status: 'archived'});
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings: managed, transactions}}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

  await chooseIndex(stdin, 11);
  expect(lastFrame()).toContain('第一學期（啟用中／目前學期）');
  expect(lastFrame()).toContain('已封存學期（已封存）');
  await choose(stdin, '2');
  expect(lastFrame()).toContain('永久刪除後無法復原');
  expect(lastFrame()).toContain('請輸入「第二學期」確認永久刪除');
});

it('keeps the prompt open when confirmation does not match', async () => {
  const onSave = vi.fn();
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings, transactions: []}}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );

  await chooseIndex(stdin, 11);
  await choose(stdin, '2');
  stdin.write('第二學期 ');
  await nextRender();
  stdin.write('\r');
  await nextRender();

  expect(lastFrame()).toContain('輸入名稱不符，未刪除學期');
  expect(lastFrame()).toContain('請輸入「第二學期」確認永久刪除');
  expect(onSave).not.toHaveBeenCalled();
});

it('permanently deletes an eligible semester and returns to its list', async () => {
  const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
  const onSaved = vi.fn();
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings, transactions: []}}
      onSave={onSave}
      onCancel={vi.fn()}
      onSaved={onSaved}
    />,
  );

  await chooseIndex(stdin, 11);
  await choose(stdin, '2');
  stdin.write('第二學期');
  await nextRender();
  stdin.write('\r');

  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]![0].semesters).not.toContainEqual({
    value: '第二學期',
    status: 'active',
  });
  expect(onSaved).toHaveBeenCalledWith(
    expect.any(Object),
    {stayOpen: true},
  );
  expect(lastFrame()).toContain('學期已永久刪除');
});

it.each([
  {
    name: 'current',
    choice: '1',
    expected: '目前學期不可刪除',
    state: {settings, transactions: []},
  },
  {
    name: 'referenced',
    choice: '2',
    expected: '此學期仍有交易，請先移動或刪除交易',
    state: {settings, transactions},
  },
])('refuses a $name semester after confirmation', async ({choice, expected, state}) => {
  const onSave = vi.fn();
  const {lastFrame, stdin} = render(
    <SettingsScreen state={state} onSave={onSave} onCancel={vi.fn()} />,
  );

  await chooseIndex(stdin, 11);
  await choose(stdin, choice);
  const value = choice === '1' ? '第一學期' : '第二學期';
  stdin.write(value);
  await nextRender();
  stdin.write('\r');
  await nextRender();

  expect(lastFrame()).toContain(expected);
  expect(onSave).not.toHaveBeenCalled();
});
```

Add separate coverage for a locked semester, `Esc` from the confirmation prompt,
a source conflict, a generic save error, and repeated Enter while a successful
deletion save remains pending. Use the stateful harness from Task 3 for one
successful deletion test; assert that the deleted label disappears while the
screen stays in the permanent-deletion semester list.

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
npm exec -w @class-fund/tui -- vitest run test/settings-screen.test.tsx
```

Expected: FAIL because the deletion action and confirmation prompt do not
exist.

- [ ] **Step 3: Add the deletion substate and confirmation prompt**

Import `deleteSemester`, add `'delete-semester'` to `Action`, and append:

```ts
{label: '永久刪除學期', value: 'delete-semester'}
```

Reuse `selectedSemester` and `optionValue`. When no semester is selected,
render the complete list with `semesterManagementLabel`. Once selected, render:

```tsx
<Box flexDirection="column">
  <Text color="red">永久刪除後無法復原</Text>
  <Text>{`請輸入「${selectedSemester}」確認永久刪除`}</Text>
  <TextInput
    value={optionValue}
    focus={!pending}
    onChange={(value) => {
      setMessage(null);
      setOptionValue(value);
    }}
    onSubmit={() => void proposeSemesterDelete()}
  />
</Box>
```

Implement submission with the domain operation and stay-open persistence:

```ts
async function proposeSemesterDelete(): Promise<void> {
  if (selectedSemester === null) return;
  try {
    const next = deleteSemester(state, selectedSemester, optionValue);
    const saved = await persist(next, 'delete-semester', {
      stayOpen: true,
      successMessage: '學期已永久刪除',
    });
    if (saved) {
      setSelectedSemester(null);
      setOptionValue('');
    }
  } catch (error) {
    setMessage(
      error instanceof LedgerValidationError
        ? validationMessage(error, 'delete-semester')
        : '設定內容無效，請檢查選擇或輸入值',
    );
  }
}
```

Escape from the prompt clears the selected semester, typed confirmation, and
message without saving. Keep input and Escape disabled while `pending` is true.

- [ ] **Step 4: Add deletion validation messages**

Extend `validationMessage`:

```ts
if (messages.includes('Semester confirmation does not match')) {
  return '輸入名稱不符，未刪除學期';
}
if (messages.includes('Current semester cannot be deleted')) {
  return '目前學期不可刪除';
}
if (messages.includes('Locked semester cannot be deleted')) {
  return '已鎖定學期不可刪除，請先解鎖';
}
if (messages.includes('Referenced semester cannot be deleted')) {
  return '此學期仍有交易，請先移動或刪除交易';
}
```

Treat `學期已永久刪除` as a green success message.

- [ ] **Step 5: Run focused and full TUI tests**

Run:

```bash
npm exec -w @class-fund/tui -- vitest run test/settings-screen.test.tsx
npm test -w @class-fund/tui
```

Expected: the focused file passes, then all TUI tests and the built-binary smoke
test pass.

- [ ] **Step 6: Commit the deletion flow**

```bash
git add apps/tui/src/screens/settings-screen.tsx apps/tui/test/settings-screen.test.tsx
git commit -m "feat: permanently delete semesters from tui"
```

### Task 5: User Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the settings instructions**

Replace the current `s` shortcut description with text that includes semester
ordering and permanent deletion:

```md
- `s`：新增學期、經手人與分類，設定目前學期與預設經手人，調整學期順序，管理學期鎖定，或封存未使用的選項。永久刪除學期時，必須輸入完整學期名稱確認。
```

Add these bullets under `學期接續與鎖定規則`:

```md
- 可在設定中逐步把學期往前或往後移；期初結餘與圖表會依儲存的順序重新計算。
- 已鎖定學期或與它相鄰的交換必須先解鎖。
- 永久刪除不會刪除交易；目前、已鎖定或仍有交易的學期不能永久刪除。
```

- [ ] **Step 2: Check the documentation diff**

Run:

```bash
git diff --check -- README.md
git diff -- README.md
```

Expected: no whitespace errors; the diff mentions only the two settings areas.

- [ ] **Step 3: Commit the documentation**

```bash
git add README.md
git commit -m "docs: explain semester management controls"
```

### Task 6: Integration, Live Order Correction, and Final Verification

**Files:**
- Modify after integration: `data/settings.json`

- [ ] **Step 1: Run the complete feature-branch verification gate**

Run from the isolated worktree:

```bash
npm test -w @class-fund/ledger
npm test -w @class-fund/tui
npm test -w @class-fund/web
npm run typecheck
npm run build
npm run test:e2e
git diff --check
git status --short
```

Expected: every command passes and the feature worktree is clean.

- [ ] **Step 2: Request branch-wide code review**

Use `superpowers:requesting-code-review` against the feature branch range.
Resolve every confirmed Critical, Important, and Minor finding with a failing
test before the fix. Re-run the affected focused suite after each change and
commit review fixes separately.

- [ ] **Step 3: Integrate the feature branch**

Use `superpowers:finishing-a-development-branch`. If the user chooses local
merge, update `main`, merge the feature branch, and run at least:

```bash
npm test
npm run typecheck
```

Do not stage or overwrite `data/settings.json`, `.superpowers/`, or
`ledger-paste.txt` during the merge.

- [ ] **Step 4: Correct only the semester order in the main checkout**

After integration, edit the existing `data/settings.json` semester array from:

```json
[
  {"value": "三上", "status": "active"},
  {"value": "暑期輔導", "status": "active"},
  {"value": "二上", "status": "active"},
  {"value": "二下", "status": "active"}
]
```

to:

```json
[
  {"value": "二上", "status": "active"},
  {"value": "二下", "status": "active"},
  {"value": "暑期輔導", "status": "active"},
  {"value": "三上", "status": "active"}
]
```

Preserve `schema_version`, `active_semester`, officers, categories,
`locked_semesters`, formatting, and every other user-owned value. Leave
`data/settings.json` unstaged because it already contains separate live-data
changes.

- [ ] **Step 5: Validate the corrected live data and exact order**

Run from the main checkout:

```bash
npm run validate:data
node --input-type=module -e "import {readFileSync} from 'node:fs'; const value=JSON.parse(readFileSync('data/settings.json','utf8')); const actual=value.semesters.map(({value})=>value); const expected=['二上','二下','暑期輔導','三上']; if (JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error('Unexpected semester order: '+actual.join(', ')); console.log(actual.join(' -> '));"
git diff --check
git status --short --branch
```

Expected:

```text
二上 -> 二下 -> 暑期輔導 -> 三上
```

`git status` must still list the user's unstaged `data/settings.json`,
`.superpowers/`, and `ledger-paste.txt`; it must not show generated test output.
