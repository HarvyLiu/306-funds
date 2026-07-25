# Add Settings Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add semesters and officers from the TUI settings screen without changing the current semester or default officer.

**Architecture:** Extend `SettingsScreen`'s existing category text-input flow to cover all three `OptionGroup` values. Reuse the ledger package's `addOption()` mutation and the current repository save callback, so validation, archived-option reactivation, conflict checks, and atomic persistence keep their existing behavior.

**Tech Stack:** TypeScript, React, Ink, `ink-select-input`, `ink-text-input`, Vitest, `ink-testing-library`

---

### Task 1: Add Semester and Officer Actions to the Settings Screen

**Files:**
- Modify: `apps/tui/test/settings-screen.test.tsx`
- Modify: `apps/tui/src/screens/settings-screen.tsx`

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

- [ ] **Step 3: Write failing tests for archived reactivation, duplicate messages, and cancellation**

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

- [ ] **Step 4: Run the focused tests and confirm RED**

Run:

```bash
npm test -w @class-fund/tui -- settings-screen.test.tsx
```

Expected: the existing tests with updated indices and the new tests fail because
`新增學期` and `新增經手人` do not exist. Duplicate semester and officer messages
also fall back to the generic validation message.

- [ ] **Step 5: Implement the shared add-option flow**

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

type AddAction = Extract<Action, `add-${string}`>;

function isAddAction(action: Action): action is AddAction {
  return action.startsWith('add-');
}

function addGroup(action: AddAction): OptionGroup {
  if (action === 'add-semester') return 'semesters';
  if (action === 'add-officer') return 'officers';
  return 'categories';
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
  next = addOption(state, addGroup(action), value);
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

- [ ] **Step 6: Run focused and full TUI tests and confirm GREEN**

Run:

```bash
npm test -w @class-fund/tui -- settings-screen.test.tsx
npm test -w @class-fund/tui
```

Expected: all settings-screen tests pass, followed by all TUI tests.

- [ ] **Step 7: Commit the tested settings behavior**

Stage only the settings screen and its test. Do not stage `data/settings.json`.

```bash
git add apps/tui/src/screens/settings-screen.tsx apps/tui/test/settings-screen.test.tsx
git commit -m "feat: add semester and officer settings"
```

### Task 2: Update Operating Documentation and Verify the Release

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the settings command documentation**

Replace the `s` command bullet with:

```markdown
- `s`：新增學期、經手人與分類，設定目前學期與預設經手人，或封存未使用的選項。新增學期或經手人後，需另外設為目前值或預設值。被交易引用的選項，以及目前預設值，不能直接封存。
```

- [ ] **Step 2: Run the full release gate**

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
- `git status --short` lists `README.md` and the user's pre-existing
  `data/settings.json` change only.

- [ ] **Step 3: Commit the documentation without ledger data**

```bash
git add README.md
git commit -m "docs: explain configurable settings options"
```

- [ ] **Step 4: Verify final scope**

Run:

```bash
git status --short
git log -3 --oneline
```

Expected: `data/settings.json` remains modified and uncommitted. The two
implementation commits appear above the design and plan documentation commits.
