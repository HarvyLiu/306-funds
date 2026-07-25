# Add Settings Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add semesters and officers from the TUI settings screen without changing the current semester or default officer.

**Architecture:** Extend `SettingsScreen`'s category text-input flow to cover all three `OptionGroup` values. Update the ledger package's `addOption()` mutation so an archived match becomes active while an active duplicate still fails validation. Keep the current repository save callback, conflict checks, and atomic persistence path.

**Tech Stack:** TypeScript, React, Ink, `ink-select-input`, `ink-text-input`, Vitest, `ink-testing-library`

---

### Task 1: Add Semester and Officer Actions to the Settings Screen

**Files:**
- Modify: `apps/tui/test/settings-screen.test.tsx`
- Modify: `apps/tui/src/screens/settings-screen.tsx`
- Modify: `packages/ledger/test/mutations.test.ts`
- Modify: `packages/ledger/src/mutations.ts`

- [ ] **Step 1: Update existing menu-index tests for the expanded action menu**

The final action order is:

```text
1  目前學期
2  預設經手人
3  新增學期
4  新增經手人
5  新增分類
6  封存學期
7  封存分類
8  封存經手人
```

In `apps/tui/test/settings-screen.test.tsx`, update the existing numeric actions before adding new tests:

```ts
// In "persists a configured settings operation"
{
  action: '7',
  choice: '3',
  assertion: (next: LedgerSettings) =>
    expect(next.categories).toContainEqual({
      value: '未被引用的分類',
      status: 'archived',
    }),
},

// In "adds the 場地費 category"
await choose(stdin, '5');

// In "shows a refusal reason without saving"
{action: '6', choice: '1', reason: '目前學期不可封存'},
{action: '7', choice: '2', reason: '此分類已被交易引用，無法封存'},
{action: '8', choice: '1', reason: '預設經手人不可封存'},

// In the source-conflict test
await choose(stdin, '5');
```

- [ ] **Step 2: Write failing tests for adding semesters and officers**

Add this parameterized test inside `describe('SettingsScreen', ...)`:

```tsx
it.each([
  {
    action: '3',
    value: '第三學期',
    group: 'semesters' as const,
    expectedCurrent: '第一學期',
  },
  {
    action: '4',
    value: '新任總務',
    group: 'officers' as const,
    expectedCurrent: '我',
  },
])(
  'adds $value without changing the current/default selection',
  async ({action, value, group, expectedCurrent}) => {
    const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
    const {stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, action);
    stdin.write(value);
    await nextRender();
    stdin.write('\r');

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0]![0];
    expect(saved[group]).toContainEqual({value, status: 'active'});
    expect(
      group === 'semesters' ? saved.active_semester : saved.default_officer,
    ).toBe(expectedCurrent);
  },
);
```

- [ ] **Step 3: Write failing tests for reactivation, validation, and cancellation**

Add the archived-value test:

```tsx
it.each([
  {action: '3', group: 'semesters' as const, value: '已封存學期'},
  {action: '4', group: 'officers' as const, value: '已卸任總務'},
])('reactivates an archived $group option', async ({action, group, value}) => {
  const archivedSettings = structuredClone(settings);
  archivedSettings[group].push({value, status: 'archived'});
  const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
  const {stdin} = render(
    <SettingsScreen
      state={{settings: archivedSettings, transactions}}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );

  await choose(stdin, action);
  stdin.write(value);
  await nextRender();
  stdin.write('\r');

  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0]![0][group]).toContainEqual({
    value,
    status: 'active',
  });
});
```

Add group-specific duplicate tests:

```tsx
it.each([
  {action: '3', value: '第一學期', reason: '此學期已存在'},
  {action: '4', value: '我', reason: '此經手人已存在'},
  {action: '5', value: '期初餘額', reason: '此分類已存在'},
])('shows $reason for an active duplicate', async ({action, value, reason}) => {
  const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings, transactions}}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );

  await choose(stdin, action);
  stdin.write(value);
  await nextRender();
  stdin.write('\r');

  await vi.waitFor(() => expect(lastFrame()).toContain(reason));
  expect(onSave).not.toHaveBeenCalled();
});
```

Add cancellation coverage:

```tsx
it('cancels an add action without saving', async () => {
  const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings, transactions}}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );

  await choose(stdin, '3');
  stdin.write('不儲存的學期');
  await nextRender();
  stdin.write('\u001b[27u');
  await nextRender();

  expect(lastFrame()).toContain('目前學期');
  expect(lastFrame()).toContain('新增學期');
  expect(onSave).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: Write failing ledger tests for duplicate handling and reactivation**

In `packages/ledger/test/mutations.test.ts`, replace the test that rejects both
active and archived category duplicates with two parameterized tests. Keep
active duplicate rejection for every option group:

```ts
test.each([
  {group: 'semesters', value: '第一學期'},
  {group: 'categories', value: '教材與影印'},
  {group: 'officers', value: '我'},
] as const)('rejects an active $group duplicate when adding an option', ({group, value}) => {
  const state = stateFixture();
  state.settings = settingsWithArchivedOptions();

  const error = validationError(() => addOption(state, group, value));

  expectIssue(error, 'settings', group);
});
```

Require archived values to reactivate for every option group without mutating
the supplied state:

```ts
test.each([
  {group: 'semesters', value: '已封存學期'},
  {group: 'categories', value: '已封存類別'},
  {group: 'officers', value: '已卸任總務'},
] as const)(
  'reactivates an archived $group option without mutating state',
  ({group, value}) => {
    const state = stateFixture();
    state.settings = settingsWithArchivedOptions();
    const stateBefore = structuredClone(state);

    const next = addOption(state, group, value);

    expect(next[group]).toContainEqual({value, status: 'active'});
    expect(next[group].filter((option) => option.value === value)).toHaveLength(1);
    expect(next.active_semester).toBe(state.settings.active_semester);
    expect(next.default_officer).toBe(state.settings.default_officer);
    expect(state).toEqual(stateBefore);
  },
);
```

- [ ] **Step 5: Run the focused tests and confirm RED**

Run:

```bash
npm test -w @class-fund/ledger -- mutations.test.ts
npm exec -w @class-fund/tui -- vitest run settings-screen.test.tsx
```

Expected: ledger reactivation cases fail because `addOption()` still rejects
archived duplicates. The TUI tests fail because `新增學期` and `新增經手人` do
not exist, so actions `3` and `4` still select the previous category-add and
semester-archive actions.

- [ ] **Step 6: Reactivate archived options in the ledger mutation**

In `packages/ledger/src/mutations.ts`, distinguish active and archived matches:

```ts
const existing = settings[optionGroup].find(
  (option) => option.value === value,
);
if (existing?.status === 'active') {
  settingsFailure(optionGroup, 'Option value is already configured');
}
if (existing !== undefined) {
  existing.status = 'active';
  return validateSettingsValue(settings);
}
```

Keep the existing append path for new values. `validateSettingsValue()` creates
the settings clone before this block, so reactivation does not mutate the
supplied ledger state.

- [ ] **Step 7: Implement the shared add-option flow**

In `apps/tui/src/screens/settings-screen.tsx`, extend `Action` and the action menu:

```ts
type Action =
  | 'semester'
  | 'officer'
  | 'add-semester'
  | 'add-officer'
  | 'add-category'
  | 'archive-semester'
  | 'archive-category'
  | 'archive-officer';

type AddAction = Extract<Action, `add-${string}`>;

const actions: Array<{label: string; value: Action}> = [
  {label: '目前學期', value: 'semester'},
  {label: '預設經手人', value: 'officer'},
  {label: '新增學期', value: 'add-semester'},
  {label: '新增經手人', value: 'add-officer'},
  {label: '新增分類', value: 'add-category'},
  {label: '封存學期', value: 'archive-semester'},
  {label: '封存分類', value: 'archive-category'},
  {label: '封存經手人', value: 'archive-officer'},
];

const addOptionGroups: Record<AddAction, OptionGroup> = {
  'add-semester': 'semesters',
  'add-officer': 'officers',
  'add-category': 'categories',
};

function isAddAction(action: Action): action is AddAction {
  return action in addOptionGroups;
}
```

Rename the category-only input state and use it for every add action:

```ts
const [optionValue, setOptionValue] = useState('');
```

Extend duplicate validation messages:

```ts
if (messages.includes('Option value is already configured')) {
  if (action === 'add-semester') return '此學期已存在';
  if (action === 'add-officer') return '此經手人已存在';
  return '此分類已存在';
}
```

Handle all add actions in `propose` before the archive branch:

```ts
case 'add-semester':
case 'add-officer':
case 'add-category':
  next = addOption(state, addOptionGroups[action], value);
  break;
```

Render the shared text input for every add action:

```tsx
} else if (isAddAction(action)) {
  content = (
    <TextInput
      value={optionValue}
      onChange={(value) => {
        setMessage(null);
        setOptionValue(value);
      }}
      onSubmit={propose}
    />
  );
```

When selecting an action, clear stale text before opening the next input:

```ts
onSelect={(item) => {
  setMessage(null);
  setOptionValue('');
  setAction(item.value);
}}
```

- [ ] **Step 8: Run focused tests and confirm the core flow is GREEN**

Run:

```bash
npm test -w @class-fund/ledger -- mutations.test.ts
npm exec -w @class-fund/tui -- vitest run settings-screen.test.tsx
```

Expected: the focused mutation and settings-screen tests pass with the expanded
menu, shared add flow, ledger reactivation, duplicate messages, and cancellation
behavior.

- [ ] **Step 9: Write failing pending-save control tests**

The expanded menu now makes action `5` the shared category text input. Add a
deferred-save test that keeps this input locked until `onSave` settles:

```tsx
it('locks text input, cancellation, and resubmission until saving settles', async () => {
  const pendingSave = deferred();
  const onSave = vi.fn(() => pendingSave.promise);
  const onCancel = vi.fn();
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings, transactions}}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );

  await choose(stdin, '5');
  stdin.write('場地費');
  await nextRender();
  stdin.write('\r');
  await vi.waitFor(() => expect(lastFrame()).toContain('正在儲存設定'));

  stdin.write('改');
  stdin.write('\u001b[27u');
  stdin.write('\r');
  await nextRender();

  expect(lastFrame()).toContain('場地費');
  expect(lastFrame()).not.toContain('場地費改');
  expect(lastFrame()).toContain('正在儲存設定');
  expect(onSave).toHaveBeenCalledOnce();
  expect(onCancel).not.toHaveBeenCalled();

  pendingSave.resolve();
  await vi.waitFor(() => expect(lastFrame()).toContain('設定已儲存'));
  stdin.write('改');
  await nextRender();
  expect(lastFrame()).toContain('場地費改');
});
```

Add the corresponding test for option selection:

```tsx
it('locks option navigation, cancellation, and selection until saving settles', async () => {
  const pendingSave = deferred();
  const onSave = vi.fn(() => pendingSave.promise);
  const onCancel = vi.fn();
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings, transactions}}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );

  await choose(stdin, '1');
  await choose(stdin, '2');
  await vi.waitFor(() => expect(lastFrame()).toContain('正在儲存設定'));
  expect(lastFrame()).toContain('❯ 第一學期');

  stdin.write('j');
  stdin.write('1');
  stdin.write('\r');
  stdin.write('\u001b[27u');
  await nextRender();

  expect(lastFrame()).toContain('❯ 第一學期');
  expect(lastFrame()).toContain('正在儲存設定');
  expect(onSave).toHaveBeenCalledOnce();
  expect(onCancel).not.toHaveBeenCalled();

  pendingSave.resolve();
  await vi.waitFor(() => expect(lastFrame()).toContain('設定已儲存'));
  stdin.write('j');
  await nextRender();
  expect(lastFrame()).toContain('❯ 第二學期');
});
```

Run:

```bash
npm exec -w @class-fund/tui -- vitest run settings-screen.test.tsx
```

Expected: both pending-save tests fail. The focused `TextInput` accepts `改`,
and the focused `SelectInput` moves from `第一學期` while `onSave` remains
pending.

- [ ] **Step 10: Disable text and selection input while saving**

Pass the pending state to the shared text input:

```tsx
<TextInput
  value={optionValue}
  focus={!pending}
  onChange={(value) => {
    setMessage(null);
    setOptionValue(value);
  }}
  onSubmit={propose}
/>
```

Disable option navigation through the selector's focus prop:

```tsx
<SelectInput
  key={action}
  isFocused={!pending}
  items={options.map((option) => ({
    label: option.value,
    value: option.value,
  }))}
  onSelect={(item) => propose(item.value)}
/>
```

- [ ] **Step 11: Run focused and full tests and confirm GREEN**

Run:

```bash
npm test -w @class-fund/ledger -- mutations.test.ts
npm exec -w @class-fund/tui -- vitest run settings-screen.test.tsx
npm test -w @class-fund/ledger
npm test -w @class-fund/tui
```

Expected: the focused tests pass. During a pending save, text edits, option
navigation, cancellation, and repeat submissions have no effect. The full
ledger and TUI suites then pass.

- [ ] **Step 12: Commit the tested settings behavior**

Stage only the four implementation and test files. Do not stage
`data/settings.json`.

```bash
git add apps/tui/src/screens/settings-screen.tsx apps/tui/test/settings-screen.test.tsx packages/ledger/src/mutations.ts packages/ledger/test/mutations.test.ts
git commit -m "feat: add semester and officer settings"
```

### Task 2: Update Operating Documentation and Verify the Release

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-25-add-settings-options-design.md`
- Modify: `docs/superpowers/plans/2026-07-25-add-settings-options.md`

- [ ] **Step 1: Update the settings command documentation**

Replace the `s` command bullet with:

```markdown
- `s`：新增學期、經手人與分類，設定目前學期與預設經手人，或封存未使用的選項。新增學期或經手人後，需另外設為目前值或預設值。被交易引用的選項，以及目前預設值，不能直接封存。
```

- [ ] **Step 2: Reconcile the design and plan with the ledger behavior**

Record that `addOption()` changed from rejecting archived duplicates to
reactivating them across all three option groups. Keep the schema, JSON format,
and repository persistence format unchanged. Include the ledger source and test
files in Task 1's scope and TDD sequence.

- [ ] **Step 3: Run the full release gate**

Run from the repository root:

```bash
npm test -w @class-fund/ledger
npm test -w @class-fund/tui
npm run typecheck
npm run build
npm run validate:data
git diff --check
git status --short
```

Expected:

- ledger and TUI tests pass;
- the production TUI binary smoke passes as part of the TUI suite;
- typecheck reports zero diagnostics;
- build and canonical data validation exit 0;
- `git diff --check` prints nothing;
- `git status --short` lists only the three intended documentation files.

- [ ] **Step 4: Commit the documentation without ledger data**

```bash
git add README.md docs/superpowers/specs/2026-07-25-add-settings-options-design.md docs/superpowers/plans/2026-07-25-add-settings-options.md
git commit -m "docs: explain configurable settings options"
```

- [ ] **Step 5: Verify final scope**

Run:

```bash
git status --short
git log -4 --oneline
```

Expected: the worktree is clean. The implementation and operating-documentation
commits appear above the plan and design commits.
