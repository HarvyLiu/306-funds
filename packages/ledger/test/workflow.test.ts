import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, expect, test} from 'vitest';

import {
  createLedgerView,
  LedgerValidationError,
  previewAdd,
  previewDelete,
  previewEdit,
  serializeSettings,
  serializeTransactionsCsv,
  type MutationDependencies,
  type LedgerSettings,
  type TransactionInput,
} from '../src/index.js';
import {LedgerRepository} from '../src/node.js';
import {validSettings} from './fixture-settings.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true})));
});

const workflowSettings: LedgerSettings = {
  ...validSettings,
  categories: [
    ...validSettings.categories,
    {value: '清潔用品', status: 'active'},
    {value: '其他', status: 'active'},
  ],
};

async function createEmptyRepository(): Promise<{
  root: string;
  repository: LedgerRepository;
}> {
  const root = await fs.mkdtemp(join(tmpdir(), 'class-fund-workflow-'));
  roots.push(root);
  await fs.mkdir(join(root, 'data'));
  await Promise.all([
    fs.writeFile(
      join(root, 'data/settings.json'),
      serializeSettings(workflowSettings),
    ),
    fs.writeFile(
      join(root, 'data/transactions.csv'),
      serializeTransactionsCsv([], workflowSettings),
    ),
  ]);
  return {root, repository: await LedgerRepository.open(root)};
}

async function commitAdd(
  repository: LedgerRepository,
  input: TransactionInput,
  dependencies: MutationDependencies,
) {
  const preview = previewAdd(repository.getState(), input, dependencies);
  await repository.saveTransactions(preview.nextTransactions);
  return preview.target;
}

async function commitEdit(
  repository: LedgerRepository,
  id: string,
  input: TransactionInput,
) {
  const preview = previewEdit(repository.getState(), id, input);
  await repository.saveTransactions(preview.nextTransactions);
}

async function commitDelete(repository: LedgerRepository, id: string) {
  const preview = previewDelete(repository.getState(), id);
  await repository.saveTransactions(preview.nextTransactions);
}

test('persists an add, edit, delete, reopen, and filtered reporting workflow', async () => {
  const {root, repository} = await createEmptyRepository();
  const ids = [
    '6ed1a6b4-1ca2-45ce-91a3-2f53e5560401',
    '6ed1a6b4-1ca2-45ce-91a3-2f53e5560402',
    '6ed1a6b4-1ca2-45ce-91a3-2f53e5560403',
    '6ed1a6b4-1ca2-45ce-91a3-2f53e5560404',
  ];
  let sequence = 0;
  const dependencies: MutationDependencies = {
    createId: () => ids[sequence]!,
    now: () =>
      `2026-08-${String(sequence++ + 1).padStart(2, '0')}T10:00:00+08:00`,
  };

  await commitAdd(
    repository,
    {
      date: '2026-08-01',
      semester: '第一學期',
      subject: '期初餘額',
      category: '期初餘額',
      type: 'income',
      amount: 5000,
      handled_by: '我',
      note: '',
    },
    dependencies,
  );
  const printing = await commitAdd(
    repository,
    {
      date: '2026-08-02',
      semester: '第一學期',
      subject: '影印',
      category: '教材與影印',
      type: 'expense',
      amount: 300,
      handled_by: '我',
      note: '',
    },
    dependencies,
  );
  await commitAdd(
    repository,
    {
      date: '2026-09-01',
      semester: '第二學期',
      subject: '掃具',
      category: '清潔用品',
      type: 'expense',
      amount: 700,
      handled_by: '另一位總務',
      note: '',
    },
    dependencies,
  );
  await commitEdit(repository, printing.id, {
    date: '2026-08-02',
    semester: '第一學期',
    subject: '影印',
    category: '教材與影印',
    type: 'expense',
    amount: 350,
    handled_by: '我',
    note: '',
  });
  const typo = await commitAdd(
    repository,
    {
      date: '2026-09-02',
      semester: '第二學期',
      subject: '誤植',
      category: '其他',
      type: 'expense',
      amount: 50,
      handled_by: '我',
      note: '',
    },
    dependencies,
  );
  await commitDelete(repository, typo.id);

  const reopened = await LedgerRepository.open(root);
  const state = reopened.getState();
  const report = createLedgerView(state.transactions, {
    semester: null,
    category: null,
    handledBy: null,
    type: null,
    search: '',
  });

  expect(state.transactions).toHaveLength(3);
  expect(report.overall).toEqual({income: 5000, expenses: 1050, net: 3950});

  const filtered = createLedgerView(state.transactions, {
    semester: '第一學期',
    category: null,
    handledBy: '我',
    type: null,
    search: '',
  });
  expect(filtered.rows.map(({transaction}) => transaction.subject)).toEqual([
    '影印',
    '期初餘額',
  ]);
  expect(filtered.filtered).toEqual({income: 5000, expenses: 350, net: 4650});
  expect(
    filtered.rows.map(({transaction, runningBalance}) => ({
      subject: transaction.subject,
      amount: transaction.amount,
      runningBalance,
    })),
  ).toEqual([
    {subject: '影印', amount: 350, runningBalance: 4650},
    {subject: '期初餘額', amount: 5000, runningBalance: 5000},
  ]);
});

test('persists a non-current semester lock and blocks its transaction mutations after reload', async () => {
  const root = await fs.mkdtemp(join(tmpdir(), 'class-fund-workflow-'));
  roots.push(root);
  const settings: LedgerSettings = {
    ...workflowSettings,
    locked_semesters: ['第二學期'],
  };
  await fs.mkdir(join(root, 'data'));
  await Promise.all([
    fs.writeFile(join(root, 'data/settings.json'), serializeSettings(settings)),
    fs.writeFile(
      join(root, 'data/transactions.csv'),
      serializeTransactionsCsv([], settings),
    ),
  ]);

  const repository = await LedgerRepository.open(root);
  await repository.saveSettings(repository.getState().settings);
  const reloaded = await LedgerRepository.open(root);

  expect(reloaded.getState().settings.locked_semesters).toEqual(['第二學期']);
  expect(() =>
    previewAdd(
      reloaded.getState(),
      {
        date: '2026-09-01',
        semester: '第二學期',
        subject: '掃具',
        category: '清潔用品',
        type: 'expense',
        amount: 700,
        handled_by: '另一位總務',
        note: '',
      },
      {
        createId: () => '6ed1a6b4-1ca2-45ce-91a3-2f53e5560499',
        now: () => '2026-09-01T10:00:00+08:00',
      },
    ),
  ).toThrow(LedgerValidationError);
});
