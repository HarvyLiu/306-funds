# Semester Carryover and Locking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive each semester's opening balance from earlier semesters and let the treasurer lock any non-current semester against transaction changes.

**Architecture:** Upgrade settings to schema version 2 while accepting version 1 through an in-memory migration. Put carryover and lock rules in the ledger package, then render those results in the TUI and public report. Keep the CSV schema and persisted transaction model unchanged.

**Tech Stack:** TypeScript, Zod, Vitest, React, Ink, Astro, Testing Library, Playwright

---

## Working Rules

- Preserve the user's uncommitted `data/settings.json` change. Do not add, restore, or rewrite that file.
- Leave the untracked `.superpowers/` directory out of commits.
- Use `git add` with the exact paths listed in each task. Check `git status --short` before every commit.
- Run each named test once while red and once after the implementation turns it green.
- Keep carryover as derived display data. Do not add a transaction, CSV column, or balance snapshot.

### Task 1: Accept Schema Version 1 and Normalize to Version 2

**Files:**
- Modify: `packages/ledger/src/types.ts`
- Modify: `packages/ledger/src/settings.ts`
- Modify: `packages/ledger/test/fixture-settings.ts`
- Modify: `packages/ledger/test/settings.test.ts`
- Modify: `packages/ledger/src/node/repository.ts`
- Test: `packages/ledger/test/repository.test.ts`
- Modify: `apps/tui/test/filter-screen.test.tsx`
- Modify: `apps/tui/test/mutations.test.tsx`
- Modify: `apps/tui/test/overview.test.tsx`
- Modify: `apps/tui/test/recovery-screen.test.tsx`
- Modify: `apps/tui/test/settings-screen.test.tsx`
- Modify: `apps/tui/test/setup-screen.test.tsx`
- Modify: `apps/tui/test/transaction-form.test.tsx`
- Modify: `apps/web/test/load-report.test.ts`
- Modify: `apps/web/test/report-app.test.tsx`

- [ ] **Step 1: Write failing schema migration tests**

Replace the old "schema version 2 is unsupported" assertion with these cases in `packages/ledger/test/settings.test.ts`:

```ts
test('migrates schema version 1 settings in memory', () => {
  const legacy = structuredClone(validSettings) as Record<string, unknown>;
  legacy.schema_version = 1;
  delete legacy.locked_semesters;

  expect(validateSettingsValue(legacy)).toEqual({
    ...validSettings,
    schema_version: 2,
    locked_semesters: [],
  });
});

test('serializes migrated settings as deterministic schema version 2 JSON', () => {
  const legacy = structuredClone(validSettings) as Record<string, unknown>;
  legacy.schema_version = 1;
  delete legacy.locked_semesters;

  expect(serializeSettings(validateSettingsValue(legacy))).toBe(
    `${JSON.stringify(validSettings, null, 2)}\n`,
  );
});

test.each([
  {
    name: 'duplicate locked semester',
    locked_semesters: ['第二學期', '第二學期'],
    field: 'locked_semesters.1',
  },
  {
    name: 'unknown locked semester',
    locked_semesters: ['不存在的學期'],
    field: 'locked_semesters.0',
  },
  {
    name: 'archived locked semester',
    locked_semesters: ['第二學期'],
    semesters: [
      {value: '第一學期', status: 'active'},
      {value: '第二學期', status: 'archived'},
    ],
    field: 'locked_semesters.0',
  },
  {
    name: 'locked active semester',
    locked_semesters: ['第一學期'],
    field: 'active_semester',
  },
])('rejects $name', ({locked_semesters, semesters, field}) => {
  const error = validationError(() =>
    validateSettingsValue(
      settingsWith({
        locked_semesters,
        ...(semesters === undefined ? {} : {semesters}),
      }),
    ),
  );

  expect(error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({source: 'settings', field}),
    ]),
  );
});
```

Add a repository assertion that a valid version-1 settings file opens as an
in-memory version-2 state without rewriting the source:

```ts
test('opens version 1 settings as version 2 without rewriting the file', async () => {
  const root = await createRoot();
  const path = ledgerPaths(root).settings;
  const legacy = structuredClone(validSettings) as Record<string, unknown>;
  legacy.schema_version = 1;
  delete legacy.locked_semesters;
  const legacyText = `${JSON.stringify(legacy, null, 2)}\n`;
  await fs.writeFile(path, legacyText);

  const repository = await LedgerRepository.open(root);

  expect(repository.getState().settings).toMatchObject({
    schema_version: 2,
    locked_semesters: [],
  });
  expect(await readUtf8(path)).toBe(legacyText);
});
```

- [ ] **Step 2: Run the focused settings tests and confirm failure**

Run:

```bash
npm exec -w @class-fund/ledger -- vitest run settings.test.ts repository.test.ts
```

Expected: type errors or assertions fail because `LedgerSettings` still uses schema version 1 and has no `locked_semesters` field.

- [ ] **Step 3: Implement a safe version-1 migration and version-2 validation**

Change `LedgerSettings` in `packages/ledger/src/types.ts`:

```ts
export interface LedgerSettings {
  schema_version: 2;
  currency: 'TWD';
  active_semester: string;
  default_officer: string;
  locked_semesters: string[];
  semesters: LedgerOption[];
  categories: LedgerOption[];
  officers: LedgerOption[];
}
```

In `packages/ledger/src/settings.ts`, define strict version-1 and version-2 schemas, snapshot the untrusted value once, and normalize version 1 before semantic validation:

```ts
const settingsFields = {
  currency: z.literal('TWD'),
  active_semester: persistedValueSchema,
  default_officer: persistedValueSchema,
  semesters: z.array(optionSchema),
  categories: z.array(optionSchema),
  officers: z.array(optionSchema),
};

const settingsV1Schema = z.strictObject({
  schema_version: z.literal(1),
  ...settingsFields,
});

const settingsV2Schema = z.strictObject({
  schema_version: z.literal(2),
  ...settingsFields,
  locked_semesters: z.array(persistedValueSchema),
});

const persistedSettingsSchema = z.discriminatedUnion('schema_version', [
  settingsV1Schema,
  settingsV2Schema,
]);

function migrateSettings(
  settings: z.infer<typeof persistedSettingsSchema>,
): LedgerSettings {
  return settings.schema_version === 1
    ? {...settings, schema_version: 2, locked_semesters: []}
    : settings;
}
```

Extend semantic validation with exact issue paths:

```ts
function addLockedSemesterIssues(
  issues: LedgerIssue[],
  settings: Record<string, unknown>,
): void {
  if (!Array.isArray(settings.locked_semesters)) return;

  const activeSemesters = new Set(
    Array.isArray(settings.semesters)
      ? settings.semesters.flatMap((candidate) => {
          const option = inspectOption(candidate);
          return option?.status === 'active' ? [option.value] : [];
        })
      : [],
  );
  const seen = new Set<string>();

  settings.locked_semesters.forEach((candidate, index) => {
    if (typeof candidate !== 'string') return;
    if (seen.has(candidate)) {
      issues.push(
        ledgerIssue(
          `locked_semesters.${index}`,
          candidate,
          'Locked semester values must be unique',
        ),
      );
    } else if (!activeSemesters.has(candidate)) {
      issues.push(
        ledgerIssue(
          `locked_semesters.${index}`,
          candidate,
          'Locked semester must reference an active option',
        ),
      );
    }
    seen.add(candidate);
  });

  if (
    typeof settings.active_semester === 'string' &&
    settings.locked_semesters.includes(settings.active_semester)
  ) {
    issues.push(
      ledgerIssue(
        'active_semester',
        settings.active_semester,
        'Active semester cannot be locked',
      ),
    );
  }
}
```

Keep the existing accessor-failure protections. Run Zod on the snapshot, call `migrateSettings` after structural parsing succeeds, call `semanticIssues` on that parsed or migrated snapshot, and return the migrated settings. Do not inspect the original object again after the snapshot.

Change `independentTransactionSettings` in
`packages/ledger/src/node/repository.ts` to return schema version 2:

```ts
{
  schema_version: 2,
  currency: 'TWD',
  active_semester: semesters[0]?.value ?? '',
  default_officer: officers[0]?.value ?? '',
  locked_semesters: [],
  semesters,
  categories,
  officers,
}
```

- [ ] **Step 4: Update typed fixtures without rewriting persisted user data**

For every TypeScript `LedgerSettings` literal listed in this task, replace:

```ts
schema_version: 1,
```

with:

```ts
schema_version: 2,
locked_semesters: [],
```

Keep `apps/web/test/fixtures/repo/data/settings.json` at version 1 so `loadReport` exercises migration. Keep `data/settings.json` untouched.

- [ ] **Step 5: Run focused and package tests**

Run:

```bash
npm exec -w @class-fund/ledger -- vitest run settings.test.ts repository.test.ts
npm test -w @class-fund/ledger
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the schema migration**

Run:

```bash
git status --short
git add packages/ledger/src/types.ts packages/ledger/src/settings.ts packages/ledger/src/node/repository.ts packages/ledger/test/fixture-settings.ts packages/ledger/test/settings.test.ts packages/ledger/test/repository.test.ts apps/tui/test/filter-screen.test.tsx apps/tui/test/mutations.test.tsx apps/tui/test/overview.test.tsx apps/tui/test/recovery-screen.test.tsx apps/tui/test/settings-screen.test.tsx apps/tui/test/setup-screen.test.tsx apps/tui/test/transaction-form.test.tsx apps/web/test/load-report.test.ts apps/web/test/report-app.test.tsx
git commit -m "feat: migrate settings for semester locks"
```

### Task 2: Calculate Semester Opening Balances

**Files:**
- Modify: `packages/ledger/src/calculations.ts`
- Test: `packages/ledger/test/calculations.test.ts`

- [ ] **Step 1: Write failing carryover tests**

Import `calculateSemesterOpeningBalance` and add a table-driven test with transactions in list order that differs from date order:

```ts
describe('calculateSemesterOpeningBalance', () => {
  test('uses configured semester order and recalculates from earlier activity', () => {
    const settings = structuredClone(validSettings);
    settings.semesters = [
      {value: '三上', status: 'active'},
      {value: '暑期輔導', status: 'active'},
      {value: '三下', status: 'active'},
    ];
    settings.active_semester = '三下';
    const transactions = [
      transactionWith('summer-expense', {semester: '暑期輔導', type: 'expense', amount: 800}),
      transactionWith('fall-income', {semester: '三上', type: 'income', amount: 5000}),
      transactionWith('spring-income', {semester: '三下', type: 'income', amount: 900}),
    ];

    expect(calculateSemesterOpeningBalance(settings, transactions, '三上')).toBe(0);
    expect(calculateSemesterOpeningBalance(settings, transactions, '暑期輔導')).toBe(5000);
    expect(calculateSemesterOpeningBalance(settings, transactions, '三下')).toBe(4200);

    transactions[1] = {...transactions[1]!, amount: 4500};
    expect(calculateSemesterOpeningBalance(settings, transactions, '三下')).toBe(3700);
  });

  test('supports zero and negative carryover without changing report totals', () => {
    const settings = structuredClone(validSettings);
    const transactions = [
      transactionWith('income', {semester: '第一學期', type: 'income', amount: 500}),
      transactionWith('expense', {semester: '第一學期', type: 'expense', amount: 700}),
      transactionWith('later', {semester: '第二學期', type: 'income', amount: 300}),
    ];
    const before = createLedgerView(transactions, {...emptyFilter});

    expect(calculateSemesterOpeningBalance(settings, transactions, '第二學期')).toBe(-200);
    expect(createLedgerView(transactions, {...emptyFilter})).toEqual(before);
  });

  test('rejects an unconfigured target and unsafe sums', () => {
    expect(() =>
      calculateSemesterOpeningBalance(validSettings, [], '不存在的學期'),
    ).toThrow('Semester is not configured');
    expect(() =>
      calculateSemesterOpeningBalance(
        validSettings,
        unsafeTransactions('income'),
        '第二學期',
      ),
    ).toThrow('Ledger calculation exceeds the safe integer range');
  });
});
```

Use the test file's existing transaction factory names; spell out each override and expected value as above.

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
npm exec -w @class-fund/ledger -- vitest run calculations.test.ts
```

Expected: the new import or assertions fail because the function does not exist.

- [ ] **Step 3: Implement the pure calculation**

Export the existing safe addition helper for internal reuse or keep it private and call `calculateTotals` on the selected set. Add:

```ts
export function calculateSemesterOpeningBalance(
  settings: LedgerSettings,
  transactions: readonly Transaction[],
  semester: string,
): number {
  const semesterIndex = settings.semesters.findIndex(
    (option) => option.value === semester,
  );
  if (semesterIndex === -1) {
    throw new RangeError('Semester is not configured');
  }

  const earlierSemesters = new Set(
    settings.semesters.slice(0, semesterIndex).map((option) => option.value),
  );
  return calculateTotals(
    transactions.filter((transaction) =>
      earlierSemesters.has(transaction.semester),
    ),
  ).net;
}
```

Import `LedgerSettings` in `calculations.ts`. Preserve input order and object identity by filtering without mutation. The totals helper supplies the existing safe-integer failure behavior.

- [ ] **Step 4: Run the ledger tests and commit**

Run:

```bash
npm exec -w @class-fund/ledger -- vitest run calculations.test.ts
npm test -w @class-fund/ledger
git status --short
git add packages/ledger/src/calculations.ts packages/ledger/test/calculations.test.ts
git commit -m "feat: calculate semester opening balances"
```

### Task 3: Enforce Semester Locks in Ledger Mutations

**Files:**
- Modify: `packages/ledger/src/mutations.ts`
- Test: `packages/ledger/test/mutations.test.ts`
- Test: `packages/ledger/test/workflow.test.ts`

- [ ] **Step 1: Write failing lock mutation tests**

Add tests for `isSemesterLocked` and `setSemesterLocked`. Define these fixtures
next to `stateFixture`:

```ts
const lockedTransaction: Transaction = {
  ...openingIncome,
  id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670099',
  semester: '第二學期',
};

function lockedSecondSemesterState(
  transactions: Transaction[] = [structuredClone(openingIncome)],
): LedgerState {
  const state = stateFixture();
  state.settings.locked_semesters = ['第二學期'];
  state.transactions = structuredClone(transactions);
  return state;
}
```

Then add a `test.each` matrix that covers each rejected transaction path:

```ts
test('locks and unlocks a non-current semester without mutating state', () => {
  const state = stateFixture();
  const locked = setSemesterLocked(state, '第二學期', true);

  expect(locked.locked_semesters).toEqual(['第二學期']);
  expect(state.settings.locked_semesters).toEqual([]);
  expect(isSemesterLocked(locked, '第二學期')).toBe(true);
  expect(setSemesterLocked({...state, settings: locked}, '第二學期', false).locked_semesters).toEqual([]);
});

test('rejects locking the current semester and activating a locked semester', () => {
  expect(() => setSemesterLocked(stateFixture(), '第一學期', true)).toThrow(
    'Active semester cannot be locked',
  );
  const state = stateFixture();
  state.settings.locked_semesters = ['第二學期'];
  expect(() => setActiveSemester(state, '第二學期')).toThrow(
    'Locked semester cannot become active',
  );
});

test.each([
  [
    'add into locked semester',
    () =>
      previewAdd(
        lockedSecondSemesterState(),
        {...expense, semester: '第二學期'},
        dependencies,
      ),
  ],
  [
    'edit transaction already in locked semester',
    () =>
      previewEdit(
        lockedSecondSemesterState([lockedTransaction]),
        lockedTransaction.id,
        {...expense, semester: '第二學期'},
      ),
  ],
  [
    'move transaction into locked semester',
    () =>
      previewEdit(
        lockedSecondSemesterState(),
        openingIncome.id,
        {...expense, semester: '第二學期'},
      ),
  ],
  [
    'delete from locked semester',
    () =>
      previewDelete(
        lockedSecondSemesterState([lockedTransaction]),
        lockedTransaction.id,
      ),
  ],
])('rejects %s', (_name, run) => {
  const error = validationError(run);
  expect(error.issues).toEqual([
    expect.objectContaining({
      source: 'transactions',
      field: 'semester',
      message: 'Locked semester transactions cannot be modified',
    }),
  ]);
});

test('requires unlocking a semester before archiving it', () => {
  const state = stateFixture();
  state.settings.locked_semesters = ['第二學期'];
  expect(() => archiveOption(state, 'semesters', '第二學期')).toThrow(
    'Locked semester cannot be archived',
  );
});
```

Use fixed IDs and the existing mutation dependency fixture. Assert each failed mutation leaves the source state deeply equal to its pre-call clone.

- [ ] **Step 2: Run the mutation tests and confirm failure**

Run:

```bash
npm exec -w @class-fund/ledger -- vitest run mutations.test.ts workflow.test.ts
```

Expected: imports fail or the mutation calls succeed when the tests expect rejection.

- [ ] **Step 3: Add lock helpers and guards**

Add these public functions to `packages/ledger/src/mutations.ts`:

```ts
export function isSemesterLocked(
  settings: LedgerSettings,
  semester: string,
): boolean {
  return settings.locked_semesters.includes(semester);
}

export function setSemesterLocked(
  state: LedgerState,
  value: string,
  locked: boolean,
): LedgerSettings {
  const settings = validateSettingsValue(state.settings);
  const option = settings.semesters.find(
    (candidate) => candidate.value === value && candidate.status === 'active',
  );
  if (option === undefined) {
    settingsFailure('locked_semesters', 'Semester is not an active option');
  }
  if (locked && settings.active_semester === value) {
    settingsFailure('active_semester', 'Active semester cannot be locked');
  }

  settings.locked_semesters = locked
    ? [...new Set([...settings.locked_semesters, value])]
    : settings.locked_semesters.filter((semester) => semester !== value);
  return validateSettingsValue(settings);
}
```

Add a shared guard:

```ts
function requireUnlockedSemester(
  settings: LedgerSettings,
  semester: string,
  row?: number,
): void {
  if (isSemesterLocked(settings, semester)) {
    transactionFailure(
      'semester',
      'Locked semester transactions cannot be modified',
      row,
    );
  }
}
```

Call it:

- in `previewAdd` after canonicalizing settings and before canonicalizing the candidate;
- in `previewEdit` for `original.semester` and `input.semester` before building the next list;
- in `previewDelete` for `original.semester` before filtering;
- in `archiveOption` before reference checks when the group is `semesters`;
- in `setActiveSemester` before assigning the value.

Use settings errors `Locked semester cannot be archived` and `Locked semester cannot become active` for the last two paths. When `addOption` reactivates a semester, remove that value from `locked_semesters` before validation so reactivated options start unlocked.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm exec -w @class-fund/ledger -- vitest run mutations.test.ts workflow.test.ts
npm test -w @class-fund/ledger
git status --short
git add packages/ledger/src/mutations.ts packages/ledger/test/mutations.test.ts packages/ledger/test/workflow.test.ts
git commit -m "feat: enforce semester transaction locks"
```

### Task 4: Add Semester Lock Controls to TUI Settings

**Files:**
- Modify: `apps/tui/src/screens/settings-screen.tsx`
- Test: `apps/tui/test/settings-screen.test.tsx`

- [ ] **Step 1: Write failing settings-screen tests**

Add tests that drive the menu by visible labels where possible:

```ts
it('shows semester lock status and toggles a non-current semester', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings, transactions}}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );

  await choose(stdin, '6');
  expect(lastFrame()).toContain('第一學期（未鎖定）');
  expect(lastFrame()).toContain('第二學期（未鎖定）');
  await choose(stdin, '2');
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({locked_semesters: ['第二學期']}),
  );
});

it('refuses to lock the current semester without saving', async () => {
  const onSave = vi.fn();
  const {lastFrame, stdin} = render(
    <SettingsScreen
      state={{settings, transactions}}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );
  await choose(stdin, '6');
  await choose(stdin, '1');

  expect(lastFrame()).toContain('目前學期不可鎖定');
  expect(onSave).not.toHaveBeenCalled();
});
```

Add unlock, locked-active-selector exclusion, locked-archive refusal, save conflict, and double-submit tests. Update numeric menu helpers so `學期鎖定狀態` is item 6 and archive actions are items 7, 8, and 9.

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
npm exec -w @class-fund/tui -- vitest run settings-screen.test.tsx
```

Expected: the new menu action and status labels are absent.

- [ ] **Step 3: Implement the lock selector**

Import `isSemesterLocked` and `setSemesterLocked`. Extend `Action` and `actions`:

```ts
type Action =
  | 'semester'
  | 'officer'
  | 'add-semester'
  | 'add-officer'
  | 'add-category'
  | 'semester-lock'
  | 'archive-semester'
  | 'archive-category'
  | 'archive-officer';

const actions = [
  {label: '目前學期', value: 'semester'},
  {label: '預設經手人', value: 'officer'},
  {label: '新增學期', value: 'add-semester'},
  {label: '新增經手人', value: 'add-officer'},
  {label: '新增分類', value: 'add-category'},
  {label: '學期鎖定狀態', value: 'semester-lock'},
  {label: '封存學期', value: 'archive-semester'},
  {label: '封存分類', value: 'archive-category'},
  {label: '封存經手人', value: 'archive-officer'},
] satisfies Array<{label: string; value: Action}>;
```

In `propose`, toggle from current state:

```ts
case 'semester-lock':
  next = setSemesterLocked(
    state,
    value,
    !isSemesterLocked(state.settings, value),
  );
  break;
```

For the current semester selector, exclude locked active semesters. For the lock selector, include all active semesters and label each item:

```ts
label: `${option.value}${
  isSemesterLocked(state.settings, option.value)
    ? '（已鎖定）'
    : '（未鎖定）'
}`,
```

Map ledger issue messages to:

```ts
if (messages.includes('Active semester cannot be locked')) {
  return '目前學期不可鎖定';
}
if (messages.includes('Locked semester cannot become active')) {
  return '已鎖定學期不可設為目前學期';
}
if (messages.includes('Locked semester cannot be archived')) {
  return '已鎖定學期不可封存，請先解鎖';
}
```

Reuse `persist`; do not add a password prompt or another save path.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm exec -w @class-fund/tui -- vitest run settings-screen.test.tsx
npm test -w @class-fund/tui
git status --short
git add apps/tui/src/screens/settings-screen.tsx apps/tui/test/settings-screen.test.tsx
git commit -m "feat: add semester lock controls to tui"
```

### Task 5: Block Locked TUI Actions and Show the Opening Row

**Files:**
- Modify: `apps/tui/src/app.tsx`
- Modify: `apps/tui/src/screens/transaction-form.tsx`
- Modify: `apps/tui/src/components/transaction-table.tsx`
- Modify: `apps/tui/src/ledger-issue.ts`
- Test: `apps/tui/test/mutations.test.tsx`
- Test: `apps/tui/test/transaction-form.test.tsx`
- Test: `apps/tui/test/overview.test.tsx`

- [ ] **Step 1: Write failing TUI behavior tests**

Add these assertions:

- `TransactionForm` omits locked semesters from add mode and from edit destinations.
- Editing a transaction already in a locked semester reports `此學期已鎖定，無法修改交易` without opening the form.
- Deleting a locked transaction reports the same message without opening confirmation.
- Selecting a semester filter shows `期初結餘` and its amount even when no transaction matches a secondary filter.
- Moving the selection with arrow keys still selects the first transaction, never the opening row.

Use this direct table test for selection behavior:

```tsx
const app = render(
  <TransactionTable
    rows={rows}
    selectedIndex={0}
    width={120}
    openingBalance={4000}
  />,
);
expect(app.lastFrame()).toContain('期初結餘');
expect(app.lastFrame()).toContain('NT$4,000');
expect(app.lastFrame()).toMatch(/期初結餘.*\n› .*第一筆交易/s);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
npm exec -w @class-fund/tui -- vitest run mutations.test.tsx transaction-form.test.tsx overview.test.tsx
```

Expected: locked choices remain available, actions enter edit/delete flows, and no opening row renders.

- [ ] **Step 3: Filter semester form options**

Change `selectableOptions` to accept an exclusion set and use it for semesters:

```ts
function selectableOptions(
  options: readonly LedgerOption[],
  currentValue: string,
  excludedValues: ReadonlySet<string> = new Set(),
): LedgerOption[] {
  return options.filter(
    (option) =>
      !excludedValues.has(option.value) &&
      (option.status === 'active' || option.value === currentValue),
  );
}
```

Pass `new Set(settings.locked_semesters)` only for the semester step. An edit from a locked semester should never reach this form because `app.tsx` blocks it first.

- [ ] **Step 4: Add the non-selectable blue opening row**

Extend `TransactionTableProps`:

```ts
export interface TransactionTableProps {
  rows: LedgerRow[];
  selectedIndex: number;
  width: number;
  openingBalance?: number;
}
```

Render a separate `TableLine` after headings and before the empty state or mapped transaction rows. Give it `marker="  "`, blue Ink text, `subject: '期初結餘'`, `balance: formatTwd(openingBalance)`, and empty strings in the other columns. Keep the row outside `rows.map`, so selection indices stay unchanged. At ultra-compact widths, make sure either `期初結餘` or the formatted balance remains visible within the existing stable width.

- [ ] **Step 5: Compute carryover and block direct locked actions in the app**

In `apps/tui/src/app.tsx`, compute:

```ts
const openingBalance = useMemo(
  () =>
    filter.semester === null
      ? undefined
      : calculateSemesterOpeningBalance(
          state.settings,
          state.transactions,
          filter.semester,
        ),
  [filter.semester, state.settings, state.transactions],
);
```

Pass `openingBalance` to `TransactionTable`. Before opening edit mode, call `isSemesterLocked` on the selected transaction's semester and set `此學期已鎖定，無法修改交易` when true. Keep `previewDelete` as the delete authority and translate `Locked semester transactions cannot be modified` in `ledger-issue.ts` to the same message.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm exec -w @class-fund/tui -- vitest run mutations.test.tsx transaction-form.test.tsx overview.test.tsx
npm test -w @class-fund/tui
git status --short
git add apps/tui/src/app.tsx apps/tui/src/screens/transaction-form.tsx apps/tui/src/components/transaction-table.tsx apps/tui/src/ledger-issue.ts apps/tui/test/mutations.test.tsx apps/tui/test/transaction-form.test.tsx apps/tui/test/overview.test.tsx
git commit -m "feat: show carryover and enforce locks in tui"
```

### Task 6: Show Semester Opening Balance in the Public Report

**Files:**
- Modify: `apps/web/src/components/ReportApp.tsx`
- Modify: `apps/web/src/styles/global.css`
- Test: `apps/web/test/report-app.test.tsx`
- Test: `apps/web/test/load-report.test.ts`
- Test: `apps/web/e2e/report.spec.ts`

- [ ] **Step 1: Write failing web tests**

Extend the fixture with at least one `第二學期` transaction. Add component tests:

```ts
it('shows a derived opening row only for a selected semester', async () => {
  const user = userEvent.setup();
  render(<ReportApp payload={payload} />);

  expect(screen.queryByText('期初結餘')).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('學期'), '第二學期');

  const table = screen.getByRole('table', {name: '班費交易明細'});
  const openingRow = within(table).getByText('期初結餘').closest('tr');
  expect(openingRow).not.toBeNull();
  expect(within(openingRow!).getByText('NT$4,000')).toBeVisible();
  expect(openingRow).toHaveAttribute('aria-label', '第二學期期初結餘 NT$4,000');
  expect(within(table).getAllByRole('row')).toHaveLength(3);
});

it('keeps the opening row fixed when secondary filters match no transaction', async () => {
  const user = userEvent.setup();
  render(<ReportApp payload={payload} />);
  await user.selectOptions(screen.getByLabelText('學期'), '第二學期');
  await user.type(screen.getByRole('searchbox'), '不存在');

  expect(screen.getByText('期初結餘')).toBeVisible();
  expect(screen.getByText('沒有符合篩選條件的交易')).toBeVisible();
});
```

Add a `loadReport` assertion that the version-1 JSON fixture loads as `schema_version: 2` with `locked_semesters: []`. Add browser coverage for the opening row and absence in the all-semester state.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
npm exec -w @class-fund/web -- vitest run report-app.test.tsx load-report.test.ts
```

Expected: no opening row exists and the loader assertion fails until migration is wired through its fixture.

- [ ] **Step 3: Render the derived row**

Compute the value in `ReportApp`:

```ts
const openingBalance = useMemo(
  () =>
    filter.semester === null
      ? null
      : calculateSemesterOpeningBalance(
          payload.settings,
          payload.transactions,
          filter.semester,
        ),
  [filter.semester, payload.settings, payload.transactions],
);
```

Render the opening row before the transaction empty state and mapped rows:

```tsx
{openingBalance === null ? null : (
  <tr
    className="semester-opening"
    aria-label={`${filter.semester ?? ''}期初結餘 ${formatTwd(openingBalance)}`}
  >
    <td colSpan={5}>
      <strong>期初結餘</strong>
      <span>本學期開始前的累計餘額</span>
    </td>
    <td aria-hidden="true" />
    <td className="amount-column">{formatTwd(openingBalance)}</td>
  </tr>
)}
```

Render the transaction empty-state row independently so both rows can coexist. Do not increment the transaction count or insert the row into `rows`.

Add CSS with a blue left border, blue label, pale neutral-blue background, and bold amount. Keep text as the primary identifier so color is not the only signal.

- [ ] **Step 4: Run web tests and commit**

Run:

```bash
npm exec -w @class-fund/web -- vitest run report-app.test.tsx load-report.test.ts
npm test -w @class-fund/web
git status --short
git add apps/web/src/components/ReportApp.tsx apps/web/src/styles/global.css apps/web/test/report-app.test.tsx apps/web/test/load-report.test.ts apps/web/e2e/report.spec.ts
git commit -m "feat: show semester carryover in public report"
```

### Task 7: Document Behavior and Run the Release Gate

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update operator documentation**

Document these exact rules in the existing settings and workflow sections:

```text
- 學期依新增順序接續，選擇單一學期時會顯示唯讀的「期初結餘」。
- 先切換到下一個目前學期，再鎖定已完成的學期。
- 鎖定後仍可查看資料，但不能新增、修改或刪除該學期交易。
- 解鎖不需要密碼；已鎖定學期必須先解鎖才能設為目前學期或封存。
```

Explain that old version-1 settings still load and save as version 2 on the next settings change. Do not tell users to edit `locked_semesters` by hand.

- [ ] **Step 2: Run the complete verification suite**

Run:

```bash
npm test
npm run typecheck
npm run build
npm run validate:data
npm run test:e2e
git diff --check
git status --short --branch
```

Expected: every command exits 0. `data/settings.json` remains modified and unstaged. `.superpowers/` remains untracked and unstaged.

- [ ] **Step 3: Perform manual TUI acceptance**

Run:

```bash
npm run ledger
```

Verify this sequence against a temporary fixture or disposable copy of the repository data:

1. Filter the first semester and see `期初結餘 NT$0`.
2. Switch the current semester to the next configured semester.
3. Lock the first semester and confirm its label changes to `（已鎖定）`.
4. Confirm add, edit, and delete cannot change that semester.
5. Unlock it and confirm editing becomes available.

Stop the TUI after acceptance.

- [ ] **Step 4: Commit documentation**

Run:

```bash
git status --short
git add README.md
git status --short
git commit -m "docs: explain semester carryover and locking"
```

Before committing, confirm no file other than `README.md` is staged by this task.
