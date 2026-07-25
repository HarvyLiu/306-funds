import {describe, expect, test} from 'vitest';

import {
  addOption,
  archiveOption,
  LedgerValidationError,
  previewAdd,
  previewDelete,
  previewEdit,
  setActiveSemester,
  setDefaultOfficer,
  TRANSACTION_HEADERS,
  type LedgerSettings,
  type LedgerState,
  type OptionGroup,
  type Transaction,
  type TransactionInput,
} from '../src/index.js';
import {validSettings} from './fixture-settings.js';

const dependencies = {
  createId: () => '6ed1a6b4-1ca2-45ce-91a3-2f53e55604c2',
  now: () => '2026-08-17T10:00:00+08:00',
};

const openingIncome: Transaction = {
  id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670001',
  date: '2026-08-01',
  semester: '第一學期',
  subject: '期初班費',
  category: '期初餘額',
  type: 'income',
  amount: 500,
  handled_by: '我',
  note: '',
  created_at: '2026-08-01T09:00:00+08:00',
};

const expense: TransactionInput = {
  date: '2026-08-17',
  semester: '第一學期',
  subject: '講義',
  category: '教材與影印',
  type: 'expense',
  amount: 600,
  handled_by: '我',
  note: '',
};

function stateFixture(): LedgerState {
  return {
    settings: structuredClone(validSettings),
    transactions: [structuredClone(openingIncome)],
  };
}

function validationError(run: () => unknown): LedgerValidationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerValidationError);
    return error as LedgerValidationError;
  }

  throw new Error('Expected ledger mutation validation to fail');
}

function expectIssue(
  error: LedgerValidationError,
  source: 'settings' | 'transactions',
  field: string,
): void {
  expect(error.issues).not.toHaveLength(0);
  expect(error.issues).toEqual(
    expect.arrayContaining([expect.objectContaining({source, field})]),
  );
}

function settingsWithArchivedOptions(): LedgerSettings {
  return {
    ...structuredClone(validSettings),
    semesters: [
      ...structuredClone(validSettings.semesters),
      {value: '已封存學期', status: 'archived'},
    ],
    categories: [
      ...structuredClone(validSettings.categories),
      {value: '已封存類別', status: 'archived'},
    ],
    officers: [
      ...structuredClone(validSettings.officers),
      {value: '已卸任總務', status: 'archived'},
    ],
  };
}

describe('transaction mutation previews', () => {
  test('previews an appended expense without mutating any caller input', () => {
    const state = stateFixture();
    const stateBefore = structuredClone(state);
    const inputBefore = structuredClone(expense);

    const preview = previewAdd(state, expense, dependencies);

    expect(preview.kind).toBe('add');
    expect(preview.target).toMatchObject(expense);
    expect(preview.target.id).toBe(dependencies.createId());
    expect(preview.target.created_at).toBe(
      '2026-08-17T10:00:00+08:00',
    );
    expect(Object.keys(preview.target)).toEqual(TRANSACTION_HEADERS);
    expect(preview.nextTransactions.map(({id}) => id)).toEqual([
      openingIncome.id,
      dependencies.createId(),
    ]);
    expect(preview.changedFields).toEqual(TRANSACTION_HEADERS);
    expect(preview.resultingBalance).toBe(-100);
    expect(preview.createsNegativeBalance).toBe(true);
    expect(state).toEqual(stateBefore);
    expect(state.transactions).toHaveLength(1);
    expect(expense).toEqual(inputBefore);
  });

  test('default dependencies create a lowercase UUID and offset timestamp', () => {
    const preview = previewAdd(stateFixture(), {
      ...expense,
      amount: 100,
    });

    expect(preview.target.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(preview.target.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
  });

  test('canonicalizes a runtime numeric-string amount before returning or calculating', () => {
    const runtimeInput = {
      ...expense,
      amount: '100',
    } as unknown as TransactionInput;

    const preview = previewAdd(stateFixture(), runtimeInput, dependencies);

    expect(preview.target.amount).toBe(100);
    expect(preview.nextTransactions[1]!.amount).toBe(100);
    expect(preview.resultingBalance).toBe(400);
    expect(preview.createsNegativeBalance).toBe(false);
  });

  test('edits in place, preserves identity fields, and reports canonical changed fields', () => {
    const state = stateFixture();
    const second: Transaction = {
      ...openingIncome,
      id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670002',
      subject: '原始講義',
      category: '教材與影印',
      type: 'expense',
      amount: 100,
      created_at: '2026-08-02T09:00:00+08:00',
    };
    state.transactions.push(second);
    const stateBefore = structuredClone(state);
    const replacement: TransactionInput = {
      ...second,
      date: '2026-08-18',
      subject: '更新講義',
      amount: 250,
      handled_by: '另一位總務',
    };

    const preview = previewEdit(state, second.id, replacement);

    expect(preview.kind).toBe('edit');
    expect(preview.target).toEqual({
      ...replacement,
      id: second.id,
      created_at: second.created_at,
    });
    expect(preview.nextTransactions[0]).toEqual(openingIncome);
    expect(preview.nextTransactions[1]).toEqual(preview.target);
    expect(preview.target.id).toBe(second.id);
    expect(preview.target.created_at).toBe(second.created_at);
    expect(preview.changedFields).toEqual([
      'date',
      'subject',
      'amount',
      'handled_by',
    ]);
    expect(preview.resultingBalance).toBe(250);
    expect(preview.createsNegativeBalance).toBe(false);
    expect(state).toEqual(stateBefore);
  });

  test('rejects an absent edit ID with a safe transaction issue', () => {
    const missingId = 'student-private-id';
    const error = validationError(() =>
      previewEdit(stateFixture(), missingId, expense),
    );

    expectIssue(error, 'transactions', 'id');
    expect(String(error)).not.toContain(missingId);
    expect(JSON.stringify(error.issues)).not.toContain(missingId);
  });

  test('deletes in place and returns an independent snapshot of the removed row', () => {
    const state = stateFixture();
    const second: Transaction = {
      ...openingIncome,
      id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670002',
      subject: '講義',
      category: '教材與影印',
      type: 'expense',
      amount: 100,
      created_at: '2026-08-02T09:00:00+08:00',
    };
    state.transactions.push(second);
    const stateBefore = structuredClone(state);

    const preview = previewDelete(state, openingIncome.id);

    expect(preview.kind).toBe('delete');
    expect(preview.target).toEqual(openingIncome);
    expect(preview.nextTransactions).toEqual([second]);
    expect(preview.changedFields).toEqual(TRANSACTION_HEADERS);
    expect(preview.resultingBalance).toBe(-100);
    expect(preview.createsNegativeBalance).toBe(true);
    expect(preview.target).not.toBe(state.transactions[0]);
    expect(state).toEqual(stateBefore);
  });

  test('rejects an absent delete ID with a safe transaction issue', () => {
    const missingId = 'student-private-id';
    const error = validationError(() =>
      previewDelete(stateFixture(), missingId),
    );

    expectIssue(error, 'transactions', 'id');
    expect(String(error)).not.toContain(missingId);
    expect(JSON.stringify(error.issues)).not.toContain(missingId);
  });

  test('rejects duplicate current IDs before an ambiguous delete', () => {
    const state = stateFixture();
    state.transactions.push({
      ...openingIncome,
      subject: '重複識別碼的另一筆',
      created_at: '2026-08-02T09:00:00+08:00',
    });

    const error = validationError(() =>
      previewDelete(state, openingIncome.id),
    );

    expectIssue(error, 'transactions', 'id');
    expect(error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({row: 3})]),
    );
  });

  test('normalizes a sparse current transaction list to a safe validation error', () => {
    const state = stateFixture();
    state.transactions = new Array<Transaction>(1);

    const error = validationError(() =>
      previewDelete(state, openingIncome.id),
    );

    expectIssue(error, 'transactions', '$');
    expect(String(error)).not.toContain('undefined');
  });

  test('replaces errors thrown by current-row accessors with a fresh safe issue', () => {
    const state = stateFixture();
    const secret = 'student-private-accessor-payload';
    const forgedError = new LedgerValidationError([
      {
        source: 'transactions',
        field: secret,
        value: secret,
        message: secret,
      },
    ]);
    const throwingRow = {...openingIncome};
    Object.defineProperty(throwingRow, 'id', {
      enumerable: true,
      get: () => {
        throw forgedError;
      },
    });
    state.transactions = [throwingRow];

    const error = validationError(() =>
      previewDelete(state, openingIncome.id),
    );

    expect(error).not.toBe(forgedError);
    expectIssue(error, 'transactions', '$');
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error.issues)).not.toContain(secret);
  });

  test('normalizes errors thrown while inspecting transaction input', () => {
    const secret = 'student-private-input-payload';
    const throwingInput = {...expense};
    Object.defineProperty(throwingInput, 'amount', {
      enumerable: true,
      get: () => {
        throw new Error(secret);
      },
    });

    const error = validationError(() =>
      previewAdd(stateFixture(), throwingInput, dependencies),
    );

    expectIssue(error, 'transactions', '$');
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error.issues)).not.toContain(secret);
  });

  test.each([
    {
      name: 'injected ID',
      dependencies: {...dependencies, createId: () => 'not-a-uuid'},
      field: 'id',
    },
    {
      name: 'injected timestamp',
      dependencies: {...dependencies, now: () => '2026-08-17T10:00:00Z'},
      field: 'created_at',
    },
  ])('validates the $name before returning', ({dependencies: invalid, field}) => {
    const error = validationError(() =>
      previewAdd(stateFixture(), expense, invalid),
    );

    expectIssue(error, 'transactions', field);
  });

  test.each([
    {field: 'semester', value: '不存在的學期'},
    {field: 'category', value: '不存在的類別'},
    {field: 'handled_by', value: '不存在的總務'},
  ] as const)('rejects an unknown $field option', ({field, value}) => {
    const error = validationError(() =>
      previewAdd(
        stateFixture(),
        {...expense, [field]: value},
        dependencies,
      ),
    );

    expectIssue(error, 'transactions', field);
  });

  test('preview outputs cannot be mutated to change caller-owned rows', () => {
    const state = stateFixture();
    const preview = previewAdd(state, expense, dependencies);

    preview.target.subject = '改掉 target';
    preview.nextTransactions[0]!.subject = '改掉 opening';
    preview.nextTransactions[1]!.subject = '改掉 appended';

    expect(state.transactions[0]!.subject).toBe('期初班費');
    expect(expense.subject).toBe('講義');
    expect(preview.target).not.toBe(preview.nextTransactions[1]);
  });

  test('propagates the deterministic checked-arithmetic rejection', () => {
    const state = stateFixture();
    state.transactions[0]!.amount = Number.MAX_SAFE_INTEGER;

    expect(() =>
      previewAdd(
        state,
        {...expense, type: 'income', amount: 1},
        dependencies,
      ),
    ).toThrow(new RangeError('Ledger calculation exceeds the safe integer range'));
  });
});

describe('settings option mutations', () => {
  test.each([
    {group: 'semesters', field: 'semester', value: '第二學期'},
    {group: 'categories', field: 'category', value: '教材與影印'},
    {group: 'officers', field: 'handled_by', value: '另一位總務'},
  ] as const)(
    'refuses to archive a $group option referenced by transaction.$field',
    ({group, field, value}) => {
      const state = stateFixture();
      state.transactions.push({
        ...openingIncome,
        id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670002',
        semester: '第二學期',
        category: '教材與影印',
        handled_by: '另一位總務',
        created_at: '2026-08-02T09:00:00+08:00',
      });

      const error = validationError(() => archiveOption(state, group, value));

      expectIssue(error, 'transactions', field);
    },
  );

  test('replaces errors thrown by archive reference accessors with a fresh safe issue', () => {
    const state = stateFixture();
    const settingsBefore = structuredClone(state.settings);
    const transactionsBefore = state.transactions;
    const throwingRow = state.transactions[0]!;
    const secret = 'student-private-archive-accessor';
    const forgedError = new LedgerValidationError([
      {
        source: 'transactions',
        field: secret,
        value: secret,
        message: secret,
      },
    ]);
    Object.defineProperty(throwingRow, 'category', {
      enumerable: true,
      get: () => {
        throw forgedError;
      },
    });

    const error = validationError(() =>
      archiveOption(state, 'categories', '教材與影印'),
    );

    expect(error).not.toBe(forgedError);
    expectIssue(error, 'transactions', '$');
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error.issues)).not.toContain(secret);
    expect(state.settings).toEqual(settingsBefore);
    expect(state.transactions).toBe(transactionsBefore);
    expect(state.transactions[0]).toBe(throwingRow);
  });

  test('rejects a sparse transaction list before archiving an option', () => {
    const state = stateFixture();
    state.transactions = new Array<Transaction>(1);
    const settingsBefore = structuredClone(state.settings);

    const error = validationError(() =>
      archiveOption(state, 'categories', '教材與影印'),
    );

    expectIssue(error, 'transactions', '$');
    expect(String(error)).not.toContain('undefined');
    expect(state.settings).toEqual(settingsBefore);
    expect(state.transactions).toHaveLength(1);
    expect(0 in state.transactions).toBe(false);
  });

  test('validates unrelated transactions before archiving an option', () => {
    const state = stateFixture();
    state.transactions[0]!.amount = 0;
    const stateBefore = structuredClone(state);

    const error = validationError(() =>
      archiveOption(state, 'categories', '教材與影印'),
    );

    expectIssue(error, 'transactions', 'amount');
    expect(state).toEqual(stateBefore);
  });

  test.each([
    {group: 'semesters', value: '第一學期', field: 'active_semester'},
    {group: 'officers', value: '我', field: 'default_officer'},
  ] as const)(
    'refuses to archive the current $field even in an empty ledger',
    ({group, value, field}) => {
      const state = stateFixture();
      state.transactions = [];

      const error = validationError(() => archiveOption(state, group, value));

      expectIssue(error, 'settings', field);
    },
  );

  test('archives an unreferenced nondefault option without mutating state', () => {
    const state = stateFixture();
    const stateBefore = structuredClone(state);

    const settings = archiveOption(state, 'semesters', '第二學期');

    expect(settings.semesters).toEqual([
      {value: '第一學期', status: 'active'},
      {value: '第二學期', status: 'archived'},
    ]);
    expect(settings).not.toBe(state.settings);
    expect(settings.semesters).not.toBe(state.settings.semesters);
    expect(state).toEqual(stateBefore);
  });

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

  test.each([
    {group: 'semesters', value: '已封存學期'},
    {group: 'categories', value: '已封存類別'},
    {group: 'officers', value: '已卸任總務'},
  ] as const)('reactivates an archived $group option without mutating state', ({group, value}) => {
    const state = stateFixture();
    state.settings = settingsWithArchivedOptions();
    const stateBefore = structuredClone(state);

    const settings = addOption(state, group, value);

    expect(settings[group]).toContainEqual({value, status: 'active'});
    expect(settings[group].filter((option) => option.value === value)).toHaveLength(1);
    expect(settings.active_semester).toBe(state.settings.active_semester);
    expect(settings.default_officer).toBe(state.settings.default_officer);
    expect(settings).not.toBe(state.settings);
    expect(settings[group]).not.toBe(state.settings[group]);
    expect(state).toEqual(stateBefore);
  });

  test.each(['', ' 新類別', '新類別 '])(
    'rejects a blank or padded new option: %j',
    (value) => {
      const error = validationError(() =>
        addOption(stateFixture(), 'categories', value),
      );

      expect(
        error.issues.some(
          (issue) =>
            issue.source === 'settings' &&
            issue.field.startsWith('categories.'),
        ),
      ).toBe(true);
    },
  );

  test('appends a valid active option and returns a validated clone', () => {
    const state = stateFixture();
    const stateBefore = structuredClone(state);

    const settings = addOption(state, 'categories', '班級活動');

    expect(settings.categories.at(-1)).toEqual({
      value: '班級活動',
      status: 'active',
    });
    expect(settings).not.toBe(state.settings);
    expect(settings.categories).not.toBe(state.settings.categories);
    expect(state).toEqual(stateBefore);
  });

  test('sets active semester only to an active option without mutation', () => {
    const state = stateFixture();
    const stateBefore = structuredClone(state);

    const settings = setActiveSemester(state, '第二學期');

    expect(settings.active_semester).toBe('第二學期');
    expect(settings).not.toBe(state.settings);
    expect(settings.semesters).not.toBe(state.settings.semesters);
    expect(state).toEqual(stateBefore);
  });

  test('sets default officer only to an active option without mutation', () => {
    const state = stateFixture();
    const stateBefore = structuredClone(state);

    const settings = setDefaultOfficer(state, '另一位總務');

    expect(settings.default_officer).toBe('另一位總務');
    expect(settings).not.toBe(state.settings);
    expect(settings.officers).not.toBe(state.settings.officers);
    expect(state).toEqual(stateBefore);
  });

  test.each([
    {
      name: 'archived semester',
      run: (state: LedgerState) => setActiveSemester(state, '已封存學期'),
      field: 'active_semester',
    },
    {
      name: 'absent semester',
      run: (state: LedgerState) => setActiveSemester(state, '不存在的學期'),
      field: 'active_semester',
    },
    {
      name: 'archived officer',
      run: (state: LedgerState) => setDefaultOfficer(state, '已卸任總務'),
      field: 'default_officer',
    },
    {
      name: 'absent officer',
      run: (state: LedgerState) => setDefaultOfficer(state, '不存在的總務'),
      field: 'default_officer',
    },
  ])('rejects an $name as a default', ({run, field}) => {
    const state = stateFixture();
    state.settings = settingsWithArchivedOptions();

    const error = validationError(() => run(state));

    expectIssue(error, 'settings', field);
  });

  test.each([
    {name: 'absent', value: '不存在的類別'},
    {name: 'already archived', value: '已封存類別'},
  ])('rejects an $name option archive safely', ({value}) => {
    const state = stateFixture();
    state.settings = settingsWithArchivedOptions();
    const error = validationError(() =>
      archiveOption(state, 'categories', value),
    );

    expectIssue(error, 'settings', 'categories');
    expect(String(error)).not.toContain(value);
  });

  test('rejects an unknown option group with a settings issue', () => {
    const error = validationError(() =>
      addOption(stateFixture(), 'unknown' as OptionGroup, 'value'),
    );

    expectIssue(error, 'settings', 'group');
  });
});
