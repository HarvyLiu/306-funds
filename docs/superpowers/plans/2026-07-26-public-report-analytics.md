# Public Report Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a truthful balance timeline, income and expense doughnuts, semester comparison, and largest-transaction navigation to the public report.

**Architecture:** The ledger package returns one immutable analytics model from settings, transactions, and the existing filter. React renders that model through small Chart.js components with semantic HTML data tables. The balance timeline uses all accounting activity in scope; secondary filters change point emphasis instead of recalculating the balance.

**Tech Stack:** TypeScript, Vitest, React, Chart.js 4, Testing Library, Astro, Playwright

---

## Dependencies and Working Rules

- Complete `docs/superpowers/plans/2026-07-26-semester-carryover-locking.md` first. This plan expects settings schema version 2 and `calculateSemesterOpeningBalance`.
- Preserve the user's uncommitted `data/settings.json` change. Do not add, restore, or rewrite that file.
- Leave `.superpowers/` untracked and unstaged.
- Use exact-path `git add` commands. Inspect `git status --short` before every commit.
- Start each behavior with a failing test, implement the smallest passing change, then refactor under green tests.
- Do not add forecasting, budgets, heatmaps, rankings, tracking, or server-side analytics.

## Visual Contract

The report serves students, parents, and the treasurer. Its job is to make the current fund balance and the transactions behind it easy to verify.

Use the existing Chinese sans-serif stack and data-dense report layout. Add these tokens to the current palette:

```css
--balance: #1d4ed8;
--balance-soft: #eff6ff;
--category-blue: #2563eb;
--category-green: #13795b;
--category-gold: #a16207;
--category-violet: #7c3aed;
--category-orange: #c2410c;
--category-teal: #0f766e;
--category-other: #62666d;
```

Keep income `#13795b`, expense `#b42318`, ink `#202124`, and line `#d9dcdf`. The balance timeline is the signature element: a clear blue line with a labeled opening anchor when one semester is selected. Other sections stay quiet and use rules, spacing, and headings rather than floating cards.

Use this desktop structure:

```text
Summary
Filters
Balance timeline ------------------------------------
Expense doughnut ---------------- Income doughnut ----
Semester comparison ------------- Largest movements -
Transaction table -----------------------------------
```

At 720px and below, stack every analytics section in that order. Fix chart stage heights with `min-height`, `aspect-ratio`, and responsive bounds so empty states and data-table toggles do not shift neighboring sections.

### Task 1: Build the Pure Analytics Model

**Files:**
- Create: `packages/ledger/src/analytics.ts`
- Modify: `packages/ledger/src/calculations.ts`
- Modify: `packages/ledger/src/index.ts`
- Modify: `packages/ledger/package.json`
- Create: `packages/ledger/test/analytics.test.ts`

- [ ] **Step 1: Write failing balance timeline tests**

Create `packages/ledger/test/analytics.test.ts`. Use explicit fixtures for two semesters, same-day transactions, an invalid `created_at`, and both transaction types. Start with:

```ts
import {describe, expect, test} from 'vitest';

import {createReportAnalytics} from '../src/analytics.js';
import {emptyFilter} from '../src/calculations.js';
import type {LedgerFilter, Transaction} from '../src/types.js';
import {validSettings} from './fixture-settings.js';

const transactions: Transaction[] = [
  {
    id: 'fall-income',
    date: '2026-08-01',
    semester: '第一學期',
    subject: '收班費',
    category: '班費',
    type: 'income',
    amount: 5000,
    handled_by: '我',
    note: '',
    created_at: '2026-08-01T08:00:00+08:00',
  },
  {
    id: 'fall-printing',
    date: '2026-08-20',
    semester: '第一學期',
    subject: '影印',
    category: '教材與影印',
    type: 'expense',
    amount: 300,
    handled_by: '我',
    note: '數學',
    created_at: '2026-08-20T09:00:00+08:00',
  },
  {
    id: 'fall-cleaning',
    date: '2026-08-20',
    semester: '第一學期',
    subject: '掃具',
    category: '清潔用品',
    type: 'expense',
    amount: 700,
    handled_by: '另一位總務',
    note: '',
    created_at: '2026-08-20T08:00:00+08:00',
  },
  {
    id: 'spring-income',
    date: '2027-02-01',
    semester: '第二學期',
    subject: '補收班費',
    category: '班費',
    type: 'income',
    amount: 800,
    handled_by: '我',
    note: '',
    created_at: '2027-02-01T08:00:00+08:00',
  },
];

test('creates chronological true-balance points with stable same-day order', () => {
  const analytics = createReportAnalytics(
    validSettings,
    transactions,
    {...emptyFilter},
  );

  expect(analytics.balancePoints).toEqual([
    expect.objectContaining({transactionId: 'fall-income', signedAmount: 5000, balance: 5000}),
    expect.objectContaining({transactionId: 'fall-cleaning', signedAmount: -700, balance: 4300}),
    expect.objectContaining({transactionId: 'fall-printing', signedAmount: -300, balance: 4000}),
    expect.objectContaining({transactionId: 'spring-income', signedAmount: 800, balance: 4800}),
  ]);
});

test('prepends a semester opening point and keeps secondary filters as emphasis', () => {
  const filter: LedgerFilter = {
    ...emptyFilter,
    semester: '第二學期',
    category: '不存在的分類',
  };
  const analytics = createReportAnalytics(validSettings, transactions, filter);

  expect(analytics.balancePoints).toEqual([
    {
      kind: 'opening',
      transactionId: null,
      date: null,
      subject: '期初結餘',
      signedAmount: null,
      balance: 4000,
      matchesFilter: true,
    },
    expect.objectContaining({
      kind: 'transaction',
      transactionId: 'spring-income',
      balance: 4800,
      matchesFilter: false,
    }),
  ]);
});
```

Add an immutability assertion by cloning settings and transactions before the call and comparing both after it.

- [ ] **Step 2: Write failing category, comparison, and largest-item tests**

Add these cases with explicit amounts:

```ts
test('groups the five largest categories and combines the remainder as other', () => {
  const categoryTransactions = [
    expense('a', '甲', 600),
    expense('b', '乙', 500),
    expense('c', '丙', 400),
    expense('d', '丁', 300),
    expense('e', '戊', 200),
    expense('f', '己', 100),
    expense('g', '庚', 50),
  ];
  const {expenseCategories} = createReportAnalytics(
    settingsFor(categoryTransactions),
    categoryTransactions,
    {...emptyFilter},
  );

  expect(expenseCategories).toEqual([
    expect.objectContaining({category: '甲', amount: 600, count: 1, percentage: 27.9, groupedCategories: ['甲']}),
    expect.objectContaining({category: '乙', amount: 500, count: 1, percentage: 23.3}),
    expect.objectContaining({category: '丙', amount: 400, count: 1, percentage: 18.6}),
    expect.objectContaining({category: '丁', amount: 300, count: 1, percentage: 14}),
    expect.objectContaining({category: '戊', amount: 200, count: 1, percentage: 9.3}),
    expect.objectContaining({category: '其他', amount: 150, count: 2, percentage: 7, groupedCategories: ['己', '庚']}),
  ]);
});

test('returns filtered semester bars with literal opening and ending balances', () => {
  const analytics = createReportAnalytics(validSettings, transactions, {
    ...emptyFilter,
    handledBy: '我',
  });

  expect(analytics.semesters).toEqual([
    {semester: '第一學期', income: 5000, expenses: 300, openingBalance: 0, endingBalance: 4000},
    {semester: '第二學期', income: 800, expenses: 0, openingBalance: 4000, endingBalance: 4800},
  ]);
});

test('orders largest matching transactions by amount, newest date, creation, then id', () => {
  const largest = createReportAnalytics(
    validSettings,
    largestTieTransactions,
    {...emptyFilter},
  ).largestTransactions;

  expect(largest.map(({transactionId}) => transactionId)).toEqual([
    'largest',
    'newer-date',
    'newer-created',
    'id-a',
    'id-b',
  ]);
});
```

Also cover:

- income and expense use separate category lists;
- a type filter empties the opposite list;
- equal category amounts use ascending category text;
- the single-category percentage is `100`;
- empty input returns empty arrays;
- a selected semester returns one comparison entry;
- zero and negative balances remain numeric;
- safe-integer overflow throws `Ledger calculation exceeds the safe integer range`.

- [ ] **Step 3: Run the analytics test and confirm failure**

Run:

```bash
npm exec -w @class-fund/ledger -- vitest run analytics.test.ts
```

Expected: the module or exported function does not exist.

- [ ] **Step 4: Define the public analytics types**

Create `packages/ledger/src/analytics.ts` with:

```ts
import {
  addSafeInteger,
  calculateSemesterOpeningBalance,
  calculateTotals,
  matchesFilter,
  orderTransactions,
} from './calculations.js';
import type {
  LedgerFilter,
  LedgerSettings,
  Transaction,
  TransactionType,
} from './types.js';

export interface BalancePoint {
  kind: 'opening' | 'transaction';
  transactionId: string | null;
  date: string | null;
  subject: string;
  signedAmount: number | null;
  balance: number;
  matchesFilter: boolean;
}

export interface CategorySlice {
  category: string;
  amount: number;
  count: number;
  percentage: number;
  groupedCategories: string[];
}

export interface SemesterAnalytics {
  semester: string;
  income: number;
  expenses: number;
  openingBalance: number;
  endingBalance: number;
}

export interface LargestTransaction {
  transactionId: string;
  date: string;
  subject: string;
  category: string;
  type: TransactionType;
  signedAmount: number;
}

export interface ReportAnalytics {
  balancePoints: BalancePoint[];
  incomeCategories: CategorySlice[];
  expenseCategories: CategorySlice[];
  semesters: SemesterAnalytics[];
  largestTransactions: LargestTransaction[];
}
```

Export `addSafeInteger` from `calculations.ts` without changing its error message. Re-export analytics from `packages/ledger/src/index.ts`, and add this package export:

```json
"./analytics": "./src/analytics.ts"
```

- [ ] **Step 5: Implement balance points**

Use semester-only scope for the accounting line and the full current filter for emphasis:

```ts
function balancePoints(
  settings: LedgerSettings,
  transactions: readonly Transaction[],
  filter: LedgerFilter,
): BalancePoint[] {
  const inSemester =
    filter.semester === null
      ? transactions
      : transactions.filter(
          (transaction) => transaction.semester === filter.semester,
        );
  let balance =
    filter.semester === null
      ? 0
      : calculateSemesterOpeningBalance(
          settings,
          transactions,
          filter.semester,
        );
  const points: BalancePoint[] =
    filter.semester === null
      ? []
      : [
          {
            kind: 'opening',
            transactionId: null,
            date: null,
            subject: '期初結餘',
            signedAmount: null,
            balance,
            matchesFilter: true,
          },
        ];

  for (const transaction of orderTransactions(inSemester)) {
    const signedAmount =
      transaction.type === 'income'
        ? transaction.amount
        : -transaction.amount;
    balance = addSafeInteger(balance, signedAmount);
    points.push({
      kind: 'transaction',
      transactionId: transaction.id,
      date: transaction.date,
      subject: transaction.subject,
      signedAmount,
      balance,
      matchesFilter: matchesFilter(transaction, filter),
    });
  }

  return points;
}
```

Do not filter out dimmed points and do not let date display order affect this result.

- [ ] **Step 6: Implement category slices**

Aggregate matching positive amounts by category and type. Sort by amount descending, then category ascending. Keep five entries and combine the rest:

```ts
function roundPercentage(amount: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(100, Math.max(0, Math.round((amount / total) * 1000) / 10));
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function categorySlices(
  transactions: readonly Transaction[],
  type: TransactionType,
): CategorySlice[] {
  const groups = new Map<string, {amount: number; count: number}>();
  for (const transaction of transactions) {
    if (transaction.type !== type || transaction.amount <= 0) continue;
    const current = groups.get(transaction.category) ?? {amount: 0, count: 0};
    groups.set(transaction.category, {
      amount: addSafeInteger(current.amount, transaction.amount),
      count: current.count + 1,
    });
  }

  const ordered = [...groups.entries()].sort(
    ([leftCategory, left], [rightCategory, right]) =>
      right.amount - left.amount || compareText(leftCategory, rightCategory),
  );
  const total = calculateTotals(
    transactions.filter((transaction) => transaction.type === type),
  )[type === 'income' ? 'income' : 'expenses'];
  const visible = ordered.slice(0, 5);
  const remainder = ordered.slice(5);
  const slices = visible.map(([category, value]) => ({
    category,
    amount: value.amount,
    count: value.count,
    percentage: roundPercentage(value.amount, total),
    groupedCategories: [category],
  }));

  if (remainder.length > 0) {
    const other = remainder.reduce(
      (result, [category, value]) => ({
        amount: addSafeInteger(result.amount, value.amount),
        count: result.count + value.count,
        categories: [...result.categories, category],
      }),
      {amount: 0, count: 0, categories: [] as string[]},
    );
    slices.push({
      category: '其他',
      amount: other.amount,
      count: other.count,
      percentage: roundPercentage(other.amount, total),
      groupedCategories: other.categories,
    });
  }

  return slices;
}
```

Use the test expectation as the authority for percentage rounding. Keep
code-point comparison so category ties produce the same order in every runtime.

- [ ] **Step 7: Implement semester comparison and largest transactions**

For each configured semester in settings order:

```ts
function semesterAnalytics(
  settings: LedgerSettings,
  transactions: readonly Transaction[],
  filter: LedgerFilter,
): SemesterAnalytics[] {
  const configured = settings.semesters
    .map((option) => option.value)
    .filter(
      (semester) =>
        filter.semester === null || semester === filter.semester,
    );

  return configured.map((semester) => {
    const actual = transactions.filter(
      (transaction) => transaction.semester === semester,
    );
    const filtered = actual.filter((transaction) =>
      matchesFilter(transaction, {...filter, semester}),
    );
    const openingBalance = calculateSemesterOpeningBalance(
      settings,
      transactions,
      semester,
    );
    const activity = calculateTotals(filtered);
    const actualActivity = calculateTotals(actual);
    return {
      semester,
      income: activity.income,
      expenses: activity.expenses,
      openingBalance,
      endingBalance: addSafeInteger(openingBalance, actualActivity.net),
    };
  });
}
```

For largest items, filter with `matchesFilter`, sort by:

1. absolute amount descending;
2. date descending;
3. valid parsed `created_at` descending, with valid values before invalid values;
4. transaction ID ascending.

Return the first five as cloned scalar fields and sign expense amounts negative.

Finish `createReportAnalytics`:

```ts
export function createReportAnalytics(
  settings: LedgerSettings,
  transactions: readonly Transaction[],
  filter: LedgerFilter,
): ReportAnalytics {
  const matching = transactions.filter((transaction) =>
    matchesFilter(transaction, filter),
  );
  return {
    balancePoints: balancePoints(settings, transactions, filter),
    incomeCategories: categorySlices(matching, 'income'),
    expenseCategories: categorySlices(matching, 'expense'),
    semesters: semesterAnalytics(settings, transactions, filter),
    largestTransactions: largestTransactions(matching),
  };
}
```

- [ ] **Step 8: Run ledger verification and commit**

Run:

```bash
npm exec -w @class-fund/ledger -- vitest run analytics.test.ts calculations.test.ts
npm test -w @class-fund/ledger
npm run typecheck -w @class-fund/ledger
git status --short
git add packages/ledger/src/analytics.ts packages/ledger/src/calculations.ts packages/ledger/src/index.ts packages/ledger/package.json packages/ledger/test/analytics.test.ts
git commit -m "feat: add public report analytics model"
```

### Task 2: Add Shared Chart Lifecycle and Data Tables

**Files:**
- Create: `apps/web/src/components/ChartDataTable.tsx`
- Create: `apps/web/src/components/use-chart.ts`
- Create: `apps/web/test/chart-data-table.test.tsx`
- Create: `apps/web/test/use-chart.test.tsx`
- Modify: `apps/web/test/setup.ts`

- [ ] **Step 1: Write failing disclosure-table tests**

Add `chart-data-table.test.tsx`:

```tsx
it('reveals and hides an exact semantic data table', async () => {
  const user = userEvent.setup();
  render(
    <ChartDataTable
      label="總餘額走勢資料"
      columns={[
        {key: 'subject', heading: '項目'},
        {key: 'balance', heading: '餘額', align: 'right'},
      ]}
      rows={[{key: 'opening', subject: '期初結餘', balance: 'NT$4,000'}]}
    />,
  );

  const button = screen.getByRole('button', {name: '查看資料表'});
  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('table', {name: '總餘額走勢資料'})).not.toBeInTheDocument();
  await user.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('table', {name: '總餘額走勢資料'})).toBeVisible();
  expect(screen.getByRole('cell', {name: 'NT$4,000'})).toBeVisible();
  await user.click(screen.getByRole('button', {name: '隱藏資料表'}));
  expect(screen.queryByRole('table', {name: '總餘額走勢資料'})).not.toBeInTheDocument();
});
```

Test unique disclosure IDs when two tables render together and right-aligned numeric columns.

- [ ] **Step 2: Write failing Chart.js lifecycle tests**

Create a harness around `useChart`. Mock `chart.js` and assert:

```ts
it('destroys stale charts and reports initialization failure', () => {
  const onError = vi.fn();
  const {rerender, unmount} = render(
    <ChartHarness version={1} onError={onError} />,
  );
  const first = chartMocks.instances[0]!;

  rerender(<ChartHarness version={2} onError={onError} />);
  expect(first.destroy).toHaveBeenCalledOnce();
  const second = chartMocks.instances[1]!;
  unmount();
  expect(second.destroy).toHaveBeenCalledOnce();

  chartMocks.construct.mockImplementationOnce(() => {
    throw new Error('canvas unavailable');
  });
  render(<ChartHarness version={3} onError={onError} />);
  expect(onError).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
npm exec -w @class-fund/web -- vitest run chart-data-table.test.tsx use-chart.test.tsx
```

Expected: both modules are missing.

- [ ] **Step 4: Implement the disclosure table**

Use `useId` and local state:

```tsx
interface Column<Row> {
  key: keyof Row;
  heading: string;
  align?: 'left' | 'right';
}

interface ChartDataTableProps<Row extends {key: string}> {
  label: string;
  columns: Array<Column<Row>>;
  rows: Row[];
}

export function ChartDataTable<Row extends {key: string}>({
  label,
  columns,
  rows,
}: ChartDataTableProps<Row>) {
  const [open, setOpen] = useState(false);
  const tableId = useId();
  return (
    <div className="chart-data">
      <button
        type="button"
        className="chart-data-toggle"
        aria-expanded={open}
        aria-controls={tableId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '隱藏資料表' : '查看資料表'}
      </button>
      {open ? (
        <div className="chart-data-scroll">
          <table id={tableId} aria-label={label}>
            <thead>
              <tr>{columns.map((column) => <th key={String(column.key)}>{column.heading}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  {columns.map((column) => (
                    <td
                      key={String(column.key)}
                      className={column.align === 'right' ? 'amount-column' : undefined}
                    >
                      {String(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
```

Set table `scope="col"` on headings in the final code.

- [ ] **Step 5: Implement reusable chart lifecycle handling**

Create `use-chart.ts`:

```ts
import {Chart, type ChartConfiguration, type ChartType} from 'chart.js';
import {useEffect, useRef} from 'react';

export function useChart<TType extends ChartType>(
  configuration: ChartConfiguration<TType>,
  onError: () => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    let chart: Chart<TType> | undefined;
    try {
      chart = new Chart(canvas, configuration);
    } catch {
      onError();
    }
    return () => chart?.destroy();
  }, [configuration, onError]);

  return canvasRef;
}
```

Every caller must memoize both `configuration` and `onError`; add a comment at the hook export because an unstable callback would recreate charts on every render. Keep caught errors out of public HTML and logs.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm exec -w @class-fund/web -- vitest run chart-data-table.test.tsx use-chart.test.tsx
git status --short
git add apps/web/src/components/ChartDataTable.tsx apps/web/src/components/use-chart.ts apps/web/test/chart-data-table.test.tsx apps/web/test/use-chart.test.tsx apps/web/test/setup.ts
git commit -m "feat: add accessible chart infrastructure"
```

### Task 3: Build Balance, Doughnut, and Semester Charts

**Files:**
- Create: `apps/web/src/components/BalanceChart.tsx`
- Create: `apps/web/src/components/CategoryDoughnut.tsx`
- Create: `apps/web/src/components/SemesterComparisonChart.tsx`
- Create: `apps/web/src/components/chart-palette.ts`
- Create: `apps/web/test/balance-chart.test.tsx`
- Replace: `apps/web/test/expense-chart.test.tsx` with `apps/web/test/category-doughnut.test.tsx`
- Create: `apps/web/test/semester-comparison-chart.test.tsx`

- [ ] **Step 1: Write failing chart component tests**

Mock all registered Chart.js exports in each test. For the balance chart assert:

```tsx
render(<BalanceChart points={balancePoints} />);
expect(Chart).toHaveBeenCalledWith(
  expect.anything(),
  expect.objectContaining({
    type: 'line',
    data: expect.objectContaining({
      labels: ['期初結餘', '2027-02-01 補收班費'],
    }),
  }),
);
expect(document.querySelector('canvas[aria-label="總餘額走勢圖"]')).toBeVisible();
await user.click(screen.getByRole('button', {name: '查看資料表'}));
expect(screen.getByRole('table', {name: '總餘額走勢資料'})).toBeVisible();
expect(screen.getByText('不符合目前次要篩選')).toBeVisible();
```

Inspect the captured chart configuration and assert matching points have radius `5` and `pointStyle: 'rectRot'`; dimmed points have radius `2` and `pointStyle: 'circle'`. Assert tooltip callbacks include date, subject, signed amount, and resulting balance.

Invoke the configured external tooltip callback with the second point active and
assert the component renders this live detail:

```text
2027-02-01 補收班費 +NT$800，餘額 NT$4,800
```

For both doughnut modes assert labels, amounts, palette order, tooltip count and percentage, empty text, and `其他` grouped category names in the data table.

For semester comparison assert two bar datasets and two actual-balance line datasets:

```ts
expect(configuration.data.datasets.map(({label}) => label)).toEqual([
  '篩選收入',
  '篩選支出',
  '實際期初結餘',
  '實際期末結餘',
]);
```

Assert each component destroys the previous chart on prop changes. Make the Chart constructor throw and assert the component shows `圖表無法顯示，請查看資料表` while the disclosure remains usable.

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
npm exec -w @class-fund/web -- vitest run balance-chart.test.tsx category-doughnut.test.tsx semester-comparison-chart.test.tsx
```

Expected: the components are missing.

- [ ] **Step 3: Register Chart.js primitives in one palette module**

Create `chart-palette.ts`:

```ts
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

export const categoryColors = [
  '#2563eb',
  '#13795b',
  '#a16207',
  '#7c3aed',
  '#c2410c',
  '#0f766e',
  '#62666d',
] as const;
```

Import this module from each chart component so registration happens before construction.

- [ ] **Step 4: Implement `BalanceChart`**

Build a memoized line configuration with `animation: false`, `responsive: true`, and `maintainAspectRatio: false`. Use:

```ts
datasets: [
  {
    label: '實際總餘額',
    data: points.map(({balance}) => balance),
    borderColor: '#1d4ed8',
    backgroundColor: '#1d4ed8',
    borderWidth: 2,
    tension: 0,
    pointRadius: points.map((point) => point.matchesFilter ? 5 : 2),
    pointHoverRadius: points.map((point) => point.matchesFilter ? 7 : 4),
    pointStyle: points.map((point) => point.matchesFilter ? 'rectRot' : 'circle'),
  },
]
```

Use callback closures over `points` for tooltips. Format signed values as
`+NT$800`, `-NT$300`, and `期初結餘` for the null amount. Use labels
`期初結餘` or `${date} ${subject}`. Configure an external Chart.js tooltip that
updates a visible `<output className="chart-detail" aria-live="polite">` below
the canvas with the active point's date, item, signed amount, and resulting
balance. Clear the output when the tooltip becomes inactive. This DOM detail
must respond to both mouse and touch activation. The semantic table columns are
date, item, change, resulting balance, and filter match. Render an empty state
when `points.length === 0`.

- [ ] **Step 5: Implement `CategoryDoughnut`**

Accept:

```ts
interface CategoryDoughnutProps {
  kind: 'income' | 'expense';
  slices: CategorySlice[];
}
```

Set canvas names `分類收入比例圖` and `分類支出比例圖`. Use `cutout: '62%'`, no animation, bottom legend, and palette colors by index. Tooltip lines must contain category, formatted amount, percentage, and `${count} 筆`. Data-table columns: category, amount, percentage, count, included categories. For regular slices, display the category once; for `其他`, join `groupedCategories` with `、`.

Render `目前沒有收入資料` or `目前沒有支出資料` when empty. Do not construct a Chart instance for empty slices; keep an empty semantic result message in the region.

- [ ] **Step 6: Implement `SemesterComparisonChart`**

Use a mixed Chart.js configuration with `type: 'bar'`. Income and expense are grouped bars on the `activity` axis. Opening and ending balances are line datasets on the `balance` axis with distinct point styles and no filled area. Use:

```ts
scales: {
  activity: {
    type: 'linear',
    position: 'left',
    beginAtZero: true,
  },
  balance: {
    type: 'linear',
    position: 'right',
    grid: {drawOnChartArea: false},
  },
}
```

Label activity as filtered and balances as actual in tooltips and the semantic table. Render `目前沒有學期資料` when empty.

- [ ] **Step 7: Run the new chart tests**

Keep `ExpenseChart.tsx` until Task 4 switches `ReportApp` to the new dashboard.
This keeps the Task 3 commit buildable. Run the focused chart tests now and
defer the full web suite until the report replacement lands.

Run:

```bash
npm exec -w @class-fund/web -- vitest run balance-chart.test.tsx category-doughnut.test.tsx semester-comparison-chart.test.tsx chart-data-table.test.tsx use-chart.test.tsx
git status --short
git add apps/web/src/components/BalanceChart.tsx apps/web/src/components/CategoryDoughnut.tsx apps/web/src/components/SemesterComparisonChart.tsx apps/web/src/components/chart-palette.ts apps/web/test/balance-chart.test.tsx apps/web/test/category-doughnut.test.tsx apps/web/test/expense-chart.test.tsx apps/web/test/semester-comparison-chart.test.tsx
git commit -m "feat: add accessible analytics charts"
```

The old expense-chart test path is included because the new category-doughnut
test replaces it.

### Task 4: Compose the Analytics Dashboard and Row Navigation

**Files:**
- Create: `apps/web/src/components/AnalyticsDashboard.tsx`
- Create: `apps/web/src/components/LargestTransactions.tsx`
- Modify: `apps/web/src/components/ReportApp.tsx`
- Delete: `apps/web/src/components/ExpenseChart.tsx`
- Create: `apps/web/test/analytics-dashboard.test.tsx`
- Create: `apps/web/test/largest-transactions.test.tsx`
- Modify: `apps/web/test/report-app.test.tsx`

- [ ] **Step 1: Write failing dashboard composition tests**

Assert the dashboard exposes these named regions in order:

```ts
const regions = screen.getAllByRole('region').map(
  (region) => region.getAttribute('aria-label') ?? region.getAttribute('aria-labelledby'),
);
expect(regions).toEqual(expect.arrayContaining([
  '總餘額走勢',
  '分類支出比例',
  '分類收入比例',
  '各學期收支比較',
  '主要收支變動',
]));
```

In `report-app.test.tsx`, mock the chart canvases but keep `AnalyticsDashboard` real. Change filters and assert:

- doughnut and largest data follow all filters;
- timeline still contains every point in the selected semester;
- date order does not change analytics results;
- the old `分類支出` region is gone;
- no-results filters leave charts and table empty states usable.

- [ ] **Step 2: Write failing largest-item focus tests**

Add:

```tsx
it('focuses and highlights the matching transaction row', async () => {
  const user = userEvent.setup();
  const focusTransaction = vi.fn();
  render(
    <LargestTransactions
      transactions={largestTransactions}
      onSelect={focusTransaction}
    />,
  );
  await user.click(screen.getByRole('button', {name: /影印.*-NT\$300/}));
  expect(focusTransaction).toHaveBeenCalledWith('fall-printing');
});
```

In the report integration test, mock `HTMLElement.prototype.scrollIntoView`, activate the item with Enter, then assert the transaction row has focus, class `transaction-highlight`, and `scrollIntoView` received `{block: 'center', behavior: 'smooth'}`. Mock reduced motion and expect `behavior: 'auto'`.

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
npm exec -w @class-fund/web -- vitest run analytics-dashboard.test.tsx largest-transactions.test.tsx report-app.test.tsx
```

Expected: dashboard components and row navigation are missing.

- [ ] **Step 4: Implement `LargestTransactions`**

Render an ordered list of real buttons:

```tsx
export function LargestTransactions({transactions, onSelect}: Props) {
  if (transactions.length === 0) {
    return <p className="analytics-empty">目前沒有符合條件的收支變動</p>;
  }
  return (
    <ol className="largest-list">
      {transactions.map((transaction) => (
        <li key={transaction.transactionId}>
          <button
            type="button"
            onClick={() => onSelect(transaction.transactionId)}
            aria-label={`${transaction.date} ${transaction.subject} ${formatSignedTwd(transaction.signedAmount)}`}
          >
            <span>{transaction.date}</span>
            <strong>{transaction.subject}</strong>
            <small>{transaction.category}</small>
            <b className={transaction.type === 'income' ? 'amount-income' : 'amount-expense'}>
              {formatSignedTwd(transaction.signedAmount)}
            </b>
          </button>
        </li>
      ))}
    </ol>
  );
}
```

Add or reuse a signed TWD formatter in the ledger format module if two or more components need it. Test it in `packages/ledger/test/format.test.ts` before use.

- [ ] **Step 5: Implement `AnalyticsDashboard`**

Accept `analytics` and `onSelectTransaction`. Render full-width semantic sections without wrapping them in a dashboard card:

```tsx
<div className="analytics-dashboard">
  <section className="analytics-section balance-section" aria-label="總餘額走勢">
    <SectionHeading title="總餘額走勢" detail="實際累計餘額" />
    <BalanceChart points={analytics.balancePoints} />
  </section>
  <div className="analytics-grid analytics-grid-categories">
    <section className="analytics-section" aria-label="分類支出比例">...</section>
    <section className="analytics-section" aria-label="分類收入比例">...</section>
  </div>
  <div className="analytics-grid analytics-grid-comparison">
    <section className="analytics-section" aria-label="各學期收支比較">...</section>
    <section className="analytics-section" aria-label="主要收支變動">...</section>
  </div>
</div>
```

Use the existing `.section-heading` convention. Put filter scope descriptions in the small detail text, not in explanatory paragraphs.

- [ ] **Step 6: Integrate analytics and focusable table rows**

In `ReportApp`, compute:

```ts
const analytics = useMemo(
  () => createReportAnalytics(payload.settings, payload.transactions, filter),
  [filter, payload.settings, payload.transactions],
);
```

Keep a highlight timer ref and add:

```ts
function focusTransaction(transactionId: string): void {
  const row = document.getElementById(`transaction-${transactionId}`);
  if (!(row instanceof HTMLTableRowElement)) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView({
    block: 'center',
    behavior: reduceMotion ? 'auto' : 'smooth',
  });
  row.focus({preventScroll: true});
  setHighlightedTransaction(transactionId);
  window.clearTimeout(highlightTimer.current);
  highlightTimer.current = window.setTimeout(
    () => setHighlightedTransaction(null),
    1600,
  );
}
```

Clear the timer on unmount. Give transaction rows:

```tsx
<tr
  id={`transaction-${transaction.id}`}
  tabIndex={-1}
  className={
    highlightedTransaction === transaction.id
      ? 'transaction-highlight'
      : undefined
  }
>
```

Insert `AnalyticsDashboard` after the filtered summary and before the
transaction table. Remove the old `ExpenseChart` import and region, then delete
`apps/web/src/components/ExpenseChart.tsx`. Task 3 adds the new charts while the
old report remains buildable; Task 4 switches the report and removes the old
component in the same commit.

- [ ] **Step 7: Run web tests and commit**

Run:

```bash
npm exec -w @class-fund/web -- vitest run analytics-dashboard.test.tsx largest-transactions.test.tsx report-app.test.tsx
npm test -w @class-fund/web
git status --short
git add packages/ledger/src/format.ts packages/ledger/test/format.test.ts apps/web/src/components/AnalyticsDashboard.tsx apps/web/src/components/LargestTransactions.tsx apps/web/src/components/ReportApp.tsx apps/web/src/components/ExpenseChart.tsx apps/web/test/analytics-dashboard.test.tsx apps/web/test/largest-transactions.test.tsx apps/web/test/report-app.test.tsx
git commit -m "feat: compose public analytics dashboard"
```

Omit the two ledger format paths when no shared formatter was added.

### Task 5: Implement Responsive, Accessible Report Styling

**Files:**
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/test/responsive-css.test.ts`
- Modify: `apps/web/e2e/report.spec.ts`

- [ ] **Step 1: Write failing CSS contract tests**

Extend `responsive-css.test.ts` to require:

```ts
expect(css).toMatch(/\.analytics-grid-categories\s*{[^}]*grid-template-columns/s);
expect(css).toMatch(/\.chart-stage-balance\s*{[^}]*aspect-ratio/s);
expect(css).toMatch(/\.chart-stage-doughnut\s*{[^}]*min-height/s);
expect(css).toMatch(/\.chart-data-toggle:focus-visible/s);
expect(css).toMatch(/\.transaction-highlight\s*{[^}]*outline/s);
expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.analytics-grid/s);
expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/s);
```

Update the Playwright geometry helper to inspect every `.chart-stage`, `.chart-data-toggle`, `.largest-list button`, analytics heading, and chart data table. It must report no viewport overflow or incoherent text overlap at 1280, 768, 721, 600, 390, and 320 pixels.

- [ ] **Step 2: Run the responsive test and confirm failure**

Run:

```bash
npm exec -w @class-fund/web -- vitest run responsive-css.test.ts
```

Expected: new analytics selectors are absent.

- [ ] **Step 3: Replace old expense-chart CSS with the analytics layout**

Add:

```css
.analytics-dashboard {
  margin-top: 30px;
  border-top: 1px solid var(--line);
}

.analytics-section {
  min-width: 0;
  padding-block: 26px;
  border-bottom: 1px solid var(--line);
}

.analytics-grid {
  display: grid;
  min-width: 0;
  border-bottom: 1px solid var(--line);
}

.analytics-grid > .analytics-section {
  border-bottom: 0;
}

.analytics-grid > .analytics-section + .analytics-section {
  border-left: 1px solid var(--line);
  padding-left: 28px;
}

.analytics-grid-categories {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28px;
}

.analytics-grid-comparison {
  grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr);
  gap: 28px;
}

.chart-stage {
  position: relative;
  width: 100%;
  min-width: 0;
}

.chart-stage-balance {
  min-height: 320px;
  aspect-ratio: 16 / 5;
}

.chart-stage-doughnut {
  min-height: 280px;
  aspect-ratio: 4 / 3;
}

.chart-stage-semesters {
  min-height: 300px;
  aspect-ratio: 16 / 8;
}
```

Do not add border-radius containers around each section. The section dividers encode report structure.

- [ ] **Step 4: Style controls, data tables, and largest items**

Use icon-free text buttons because `查看資料表` is a clear command. Keep them compact with a 4px radius. Add `:focus-visible` outlines to every button. Use a square category swatch, tabular numbers, and no animation.

Give `.transaction-highlight` both a focus outline and an inset background mark:

```css
.transaction-highlight {
  outline: 3px solid var(--balance);
  outline-offset: -3px;
  background: var(--balance-soft);
}

.transaction-highlight td:first-child {
  box-shadow: inset 5px 0 0 var(--balance);
}
```

Style `.largest-list button` as a full-width four-column row on desktop and a two-column grid on narrow screens. Preserve native button focus and keep the entire label within its row.

- [ ] **Step 5: Add mobile and reduced-motion rules**

At `max-width: 720px`, set `.analytics-grid` to one column, remove the left border, restore horizontal dividers, and set all chart stages to a bounded `min-height: 250px`. At `max-width: 480px`, keep doughnuts at `aspect-ratio: 1 / 1` and set the balance chart to `aspect-ratio: 4 / 3`. Do not scale font size with viewport width.

Under reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 6: Run CSS and component tests, then commit**

Run:

```bash
npm exec -w @class-fund/web -- vitest run responsive-css.test.ts report-app.test.tsx analytics-dashboard.test.tsx
npm test -w @class-fund/web
git status --short
git add apps/web/src/styles/global.css apps/web/test/responsive-css.test.ts apps/web/e2e/report.spec.ts
git commit -m "style: lay out public report analytics"
```

### Task 6: Verify Browser Interaction, Canvas Output, and Failure Fallback

**Files:**
- Modify: `apps/web/e2e/report.spec.ts`
- Modify: `apps/web/test/client-boundary.test.ts`
- Modify: `apps/web/test/playwright-config.test.ts`
- Modify: `apps/web/test/report-app.test.tsx`
- Modify: `apps/web/test/fixtures/repo/data/settings.json`
- Modify: `apps/web/test/fixtures/repo/data/transactions.csv`

- [ ] **Step 1: Add failing Playwright analytics scenarios**

Replace the single-canvas helper with one that accepts an accessible canvas name and returns painted pixel count. Cover each canvas:

```ts
for (const name of [
  '總餘額走勢圖',
  '分類支出比例圖',
  '分類收入比例圖',
  '各學期收支比較圖',
]) {
  expect(await paintedCanvasPixels(page, name)).toBeGreaterThan(100);
}
```

Add browser tests that:

- hover a balance point and assert the visible `chart-detail` output contains
  date, subject, signed amount, and balance;
- tap the same point in the mobile project and assert the same output changes;
- reveal every `查看資料表` control and inspect exact table values by keyboard;
- filter by semester and verify the line retains every transaction in that semester while unmatched points use the smaller circle style;
- select a largest movement with Enter and confirm focus/highlight on the transaction row;
- set reduced motion and verify row navigation uses non-smooth behavior;
- filter income only and verify the expense doughnut empty state;
- exercise Chart initialization failure in a component test and verify report summary and transaction table remain usable.

Use pointer coordinates from the balance chart's rendered point geometry and
assert the production `aria-live` detail output changes after hover and tap.
The data-table assertion remains a separate keyboard-accessibility test. Do not
substitute the table assertion for tooltip interaction coverage.

- [ ] **Step 2: Run E2E once and confirm new assertions fail**

Run:

```bash
npm run test:e2e
```

Expected: old selectors or missing interactions fail before the E2E implementation is complete.

- [ ] **Step 3: Finish E2E fixtures and interaction code**

Expand `apps/web/test/fixtures/repo/data/transactions.csv` with:

- two semesters;
- at least two income categories;
- at least six expense categories so `其他` renders;
- two transactions on the same date;
- five differently sized largest transactions.

Keep amounts small and manually compute expected full balance, semester opening, filtered totals, and ending balances in test constants. Do not change production data.

Add every referenced semester, category, and officer to
`apps/web/test/fixtures/repo/data/settings.json` while keeping that fixture at
schema version 1. This preserves migration coverage and lets CSV validation
accept the expanded analytics fixture.

In `apps/web/test/report-app.test.tsx`, make the Chart constructor throw for one
render and assert `圖表無法顯示，請查看資料表`, the account summary, and the
transaction table remain visible. Reset the mock after the test.

Update the client-boundary test to allow the new chart components in the browser bundle while keeping repository and Node-only modules outside it. Keep the GitHub Pages base-path assertions in `playwright-config.test.ts` green.

- [ ] **Step 4: Run browser and production-build verification**

Run:

```bash
npm run test:e2e
npm exec -w @class-fund/web -- vitest run report-app.test.tsx client-boundary.test.ts playwright-config.test.ts
npm run build -w @class-fund/web
npm run typecheck -w @class-fund/web
```

Expected: every browser project passes, all four canvases contain painted pixels, and the Astro build exits 0.

- [ ] **Step 5: Inspect desktop and mobile screenshots**

Open the Playwright attachments for desktop and mobile. Check:

1. The balance chart has the strongest visual weight.
2. Expense and income charts read as a pair without relying on red and green alone.
3. No canvas, tooltip, legend, heading, toggle, or table overlaps at 320px.
4. Analytics sections use dividers and open space, not nested cards.
5. The first portion of the transaction table remains visible below analytics in a normal desktop full-page capture.

If a check fails, add a focused E2E geometry assertion before changing CSS, then rerun the affected project.

- [ ] **Step 6: Commit browser coverage**

Run:

```bash
git status --short
git add apps/web/e2e/report.spec.ts apps/web/test/client-boundary.test.ts apps/web/test/playwright-config.test.ts apps/web/test/report-app.test.tsx apps/web/test/fixtures/repo/data/settings.json apps/web/test/fixtures/repo/data/transactions.csv
git commit -m "test: cover public analytics interactions"
```

### Task 7: Update Documentation and Run the Complete Release Gate

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document filter semantics for report readers**

Add a compact section with these statements:

```text
- 總餘額走勢顯示真實累計餘額；分類、經手人、類型與搜尋只標示相符節點，不會重算成局部餘額。
- 收入、支出圓餅圖與主要收支變動會套用目前全部篩選條件。
- 各學期收支長條會套用篩選條件，期初與期末結餘仍顯示實際餘額。
- 每張圖可展開資料表，在鍵盤、觸控或無法顯示圖表時查看相同數值。
```

Do not describe the implementation library or teach hover gestures in visible site copy.

- [ ] **Step 2: Run every verification command from a clean process state**

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

Expected: each command exits 0. The only unrelated status entries remain the user's `data/settings.json` change and `.superpowers/`.

- [ ] **Step 3: Start the production preview and perform acceptance**

Run:

```bash
npm run preview -w @class-fund/web -- --host 127.0.0.1
```

Use the printed free port. Verify filters, all data-table toggles, largest-item navigation, and mobile layout in a browser. Confirm the public report still works when one Chart constructor throws by using the component test rather than breaking the preview bundle.

Stop the preview after acceptance.

- [ ] **Step 4: Commit documentation**

Run:

```bash
git status --short
git add README.md
git status --short
git commit -m "docs: explain public report analytics"
```

Before committing, unstage any path that belongs to the user or a generated visual workspace.
