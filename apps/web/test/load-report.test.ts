import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  LedgerValidationError,
  serializeSettings,
  serializeTransactionsCsv,
  type LedgerSettings,
  type Transaction,
} from '@class-fund/ledger';
import {afterEach, describe, expect, it} from 'vitest';

import {loadReport} from '../src/lib/load-report.js';

const validSettings: LedgerSettings = {
  schema_version: 2,
  currency: 'TWD',
  active_semester: '第一學期',
  default_officer: '我',
  locked_semesters: [],
  semesters: [
    {value: '第一學期', status: 'active'},
    {value: '第二學期', status: 'active'},
  ],
  categories: [
    {value: '期初餘額', status: 'active'},
    {value: '教材與影印', status: 'active'},
    {value: '清潔用品', status: 'active'},
  ],
  officers: [
    {value: '我', status: 'active'},
    {value: '另一位總務', status: 'active'},
  ],
};

const transactions: Transaction[] = [
  {
    id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670001',
    date: '2026-08-01',
    semester: '第一學期',
    subject: '期初班費',
    category: '期初餘額',
    type: 'income',
    amount: 5000,
    handled_by: '我',
    note: '',
    created_at: '2026-08-01T08:00:00+08:00',
  },
  {
    id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670002',
    date: '2026-08-20',
    semester: '第一學期',
    subject: '掃具',
    category: '清潔用品',
    type: 'expense',
    amount: 700,
    handled_by: '另一位總務',
    note: '教室清潔',
    created_at: '2026-08-20T08:00:00+08:00',
  },
  {
    id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670003',
    date: '2026-08-20',
    semester: '第一學期',
    subject: '影印講義',
    category: '教材與影印',
    type: 'expense',
    amount: 300,
    handled_by: '我',
    note: '數學',
    created_at: '2026-08-20T09:00:00+08:00',
  },
];

const roots: string[] = [];
const repositoryFixtureRoot = join(
  process.cwd(),
  'test/fixtures/repo',
);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, {recursive: true})),
  );
});

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'class-fund-report-'));
  roots.push(root);
  await fs.mkdir(join(root, 'data'));
  await Promise.all([
    fs.writeFile(
      join(root, 'data/settings.json'),
      serializeSettings(validSettings),
    ),
    fs.writeFile(
      join(root, 'data/transactions.csv'),
      serializeTransactionsCsv(transactions, validSettings),
    ),
  ]);
  return root;
}

describe('loadReport', () => {
  it('migrates the checked-in v1 settings fixture without editing its source', async () => {
    const settingsPath = join(repositoryFixtureRoot, 'data/settings.json');
    const sourceBefore = await fs.readFile(settingsPath, 'utf8');

    expect(JSON.parse(sourceBefore)).toMatchObject({schema_version: 1});

    const payload = await loadReport(repositoryFixtureRoot);

    expect(payload.settings).toMatchObject({
      schema_version: 2,
      locked_semesters: [],
    });
    await expect(fs.readFile(settingsPath, 'utf8')).resolves.toBe(sourceBefore);
  });

  it('loads validated source data and builds the initial full-ledger view', async () => {
    const root = await createFixture();

    const payload = await loadReport(
      root,
      () => new Date('2026-09-03T12:00:00Z'),
    );

    expect(payload.generatedAt).toBe('2026-09-03T12:00:00.000Z');
    expect(payload.settings).toEqual(validSettings);
    expect(payload.transactions).toEqual(transactions);
    expect(payload.view).toMatchObject({
      overall: {income: 5000, expenses: 1000, net: 4000},
      filtered: {income: 5000, expenses: 1000, net: 4000},
    });
    expect(payload.view.rows.map((row) => row.runningBalance)).toEqual([
      4000, 4300, 5000,
    ]);
  });

  it('preserves the shared parser error type and row metadata', async () => {
    const root = await createFixture();
    const csvPath = join(root, 'data/transactions.csv');
    const csv = await fs.readFile(csvPath, 'utf8');
    await fs.writeFile(csvPath, csv.replace(',300,', ',not-a-number,'));

    const rejected = loadReport(root);

    await expect(rejected).rejects.toBeInstanceOf(LedgerValidationError);
    await expect(rejected).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          source: 'transactions',
          row: 4,
          field: 'amount',
          value: 'not-a-number',
        }),
      ],
    });
  });
});
