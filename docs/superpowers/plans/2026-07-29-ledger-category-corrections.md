# Ledger Category Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the photographed `2026-07-23` entry and assign useful categories to cold-air, found-money, and Japanese-exchange transactions.

**Architecture:** Update the text source with an exact patch. Use the ledger's pure `addOption` and `previewEdit` mutations to prepare validated settings and transactions, then persist them through `LedgerRepository` so normal backups and conflict checks remain active.

**Tech Stack:** TypeScript, Node.js 24 with the `tsx` loader, `@class-fund/ledger`, TSV, CSV, JSON

---

### Task 1: Record the Current Category Failures

**Files:**
- Read: `data/settings.json`
- Read: `data/transactions.csv`
- Read: `ledger-paste.txt`

- [ ] **Step 1: Run the failing data audit**

Run:

```bash
node --import tsx --input-type=module -e "
const fs = await import('node:fs/promises');
const {LedgerRepository} = await import('./packages/ledger/src/node.ts');
const state = (await LedgerRepository.open(process.cwd())).getState();
const source = await fs.readFile('ledger-paste.txt', 'utf8');
const issues = [];
const cold = state.transactions.filter((row) => row.subject === '冷氣儲值');
if (cold.length !== 15 || cold.some((row) => row.category !== '冷氣')) {
  issues.push('15 cold-air rows must use 冷氣');
}
for (const [subject, category] of [
  ['拾遺', '其他'],
  ['日本交流飲料費', '活動'],
  ['清潔費', '清潔用品'],
]) {
  if (!state.transactions.some((row) => row.subject === subject && row.category === category)) {
    issues.push(subject + ' must use ' + category);
  }
}
if (!state.settings.categories.some((option) => option.value === '冷氣' && option.status === 'active')) {
  issues.push('冷氣 category must be active');
}
if (!source.includes('2026-07-23\t清潔費\t清潔用品')) {
  issues.push('TSV must contain the corrected 7/23 row');
}
if (issues.length > 0) {
  console.error(issues.join('\n'));
  process.exit(1);
}
"
```

Expected: exit 1 with the missing `冷氣` category and category mismatches. This
is the red phase.

### Task 2: Correct the Text Source

**Files:**
- Modify: `ledger-paste.txt`

- [ ] **Step 1: Apply the exact TSV changes**

Use `apply_patch` to make these replacements while preserving tabs and empty notes:

```text
Every one of the 15 rows whose item is 冷氣儲值:
  category 其他 -> 冷氣

2025-10-31  拾遺:
  category 退款 -> 其他

2025-10-31  日本交流飲料費:
  category 退款 -> 活動

2026-07-23:
  item/category 謝師宴/活動 -> 清潔費/清潔用品
```

- [ ] **Step 2: Check the changed row counts**

Run:

```bash
node -e "
const fs = require('node:fs');
const rows = fs.readFileSync('ledger-paste.txt', 'utf8').trimEnd().split(/\r?\n/).slice(1).map((line) => line.split('\t'));
const cold = rows.filter((row) => row[1] === '冷氣儲值' && row[2] === '冷氣');
if (rows.length !== 40 || cold.length !== 15) process.exit(1);
console.log(JSON.stringify({rows: rows.length, cold: cold.length}));
"
```

Expected: `{"rows":40,"cold":15}`.

### Task 3: Prepare and Save the Validated Ledger Repair

**Files:**
- Create temporarily: `/tmp/apply-ledger-category-corrections.mts`
- Modify through repository: `data/settings.json`
- Modify through repository: `data/transactions.csv`

- [ ] **Step 1: Create the guarded repair script**

Create `/tmp/apply-ledger-category-corrections.mts` with `apply_patch`:

```ts
import {
  addOption,
  calculateTotals,
  previewEdit,
  type LedgerState,
  type Transaction,
  type TransactionInput,
} from '/home/harvy/class-fund-ledger/packages/ledger/src/index.ts';
import {LedgerRepository} from '/home/harvy/class-fund-ledger/packages/ledger/src/node.ts';

const root = '/home/harvy/class-fund-ledger';
const apply = process.argv.includes('--apply');
const repository = await LedgerRepository.open(root);
let state: LedgerState = repository.getState();

if (state.settings.categories.some((option) => option.value === '冷氣')) {
  throw new Error('冷氣 category already exists');
}
const settings = addOption(state, 'categories', '冷氣');
state = {...state, settings};

function inputFrom(transaction: Transaction): TransactionInput {
  return {
    date: transaction.date,
    semester: transaction.semester,
    subject: transaction.subject,
    category: transaction.category,
    type: transaction.type,
    amount: transaction.amount,
    handled_by: transaction.handled_by,
    note: transaction.note,
  };
}

function edit(transaction: Transaction, changes: Partial<Pick<TransactionInput, 'subject' | 'category'>>): void {
  const preview = previewEdit(state, transaction.id, {...inputFrom(transaction), ...changes});
  state = {...state, transactions: preview.nextTransactions};
}

const cold = state.transactions.filter(
  (row) => row.subject === '冷氣儲值' && row.category === '其他',
);
if (cold.length !== 15) throw new Error(`Expected 15 cold-air rows, found ${cold.length}`);
for (const transaction of cold) edit(transaction, {category: '冷氣'});

const exact = (id: string, subject: string, category: string): Transaction => {
  const transaction = state.transactions.find((row) => row.id === id);
  if (transaction?.subject !== subject || transaction.category !== category) {
    throw new Error(`Stale transaction ${id}`);
  }
  return transaction;
};

edit(
  exact('f7f0dfc9-fdbe-483c-8cda-f654ba84e454', '拾遺', '退款'),
  {category: '其他'},
);
edit(
  exact('b917e6e9-e3d7-4464-8f19-2da0ec5693a4', '日本交流飲料費', '退款'),
  {category: '活動'},
);
edit(
  exact('c7145c42-ac52-4ab1-8e1e-6cb035e3aea1', '謝師宴', '活動'),
  {subject: '清潔費', category: '清潔用品'},
);

const totals = calculateTotals(state.transactions);
if (totals.income !== 195361 || totals.expenses !== 152685 || totals.net !== 42676) {
  throw new Error(`Totals changed: ${JSON.stringify(totals)}`);
}
console.log(JSON.stringify({mode: apply ? 'apply' : 'dry-run', cold: cold.length, totals}));

if (apply) {
  await repository.saveSettings(settings);
  await repository.saveTransactions(state.transactions);
}
```

- [ ] **Step 2: Run the repair in dry-run mode**

Run:

```bash
node --import tsx /tmp/apply-ledger-category-corrections.mts
```

Expected: exit 0 with `"mode":"dry-run"`, `"cold":15`, and balance `42676`.

- [ ] **Step 3: Apply the validated repair**

Run:

```bash
node --import tsx /tmp/apply-ledger-category-corrections.mts --apply
```

Expected: exit 0 with `"mode":"apply"` and the same counts and totals.

### Task 4: Verify the Saved Data

**Files:**
- Verify: `data/settings.json`
- Verify: `data/transactions.csv`
- Verify: `ledger-paste.txt`
- Delete: `/tmp/apply-ledger-category-corrections.mts`

- [ ] **Step 1: Re-run the Task 1 audit**

Run the exact command from Task 1, Step 1.

Expected: exit 0 with no issues. This is the green phase.

- [ ] **Step 2: Validate production data**

Run:

```bash
npm run validate:data
```

Expected:

```json
{"transactions":40,"income":195361,"expenses":152685,"balance":42676}
```

- [ ] **Step 3: Verify category distribution**

Run:

```bash
node --import tsx --input-type=module -e "
const {LedgerRepository} = await import('./packages/ledger/src/node.ts');
const state = (await LedgerRepository.open(process.cwd())).getState();
const counts = {};
for (const row of state.transactions) counts[row.category] = (counts[row.category] ?? 0) + 1;
console.log(JSON.stringify(counts, null, 2));
"
```

Expected counts:

```json
{
  "班費收入": 6,
  "冷氣": 15,
  "其他": 2,
  "活動": 7,
  "教材與影印": 7,
  "清潔用品": 2,
  "退款": 1
}
```

- [ ] **Step 4: Check the worktree and remove the temporary script**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: no whitespace errors. Existing user files remain modified or untracked;
no generated output appears in the repository.

Delete `/tmp/apply-ledger-category-corrections.mts` with `apply_patch`. Do not
commit or push the data changes unless the user asks.
