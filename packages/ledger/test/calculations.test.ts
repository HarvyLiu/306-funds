import {describe, expect, it} from 'vitest';

import {
  buildLedgerRows,
  calculateSemesterOpeningBalance,
  calculateTotals,
  createLedgerView,
  emptyFilter,
  matchesFilter,
  orderTransactions,
  type LedgerFilter,
  type LedgerSettings,
  type Totals,
  type Transaction,
} from '../src/index.js';

const transactions: [Transaction, Transaction, Transaction] = [
  {
    id: 'c',
    date: '2026-09-02',
    semester: '第一學期',
    subject: '影印',
    category: '教材與影印',
    type: 'expense',
    amount: 300,
    handled_by: '我',
    note: '',
    created_at: '2026-09-02T09:00:00+08:00',
  },
  {
    id: 'a',
    date: '2026-08-01',
    semester: '第一學期',
    subject: '期初',
    category: '期初餘額',
    type: 'income',
    amount: 5000,
    handled_by: '我',
    note: '',
    created_at: '2026-08-01T08:00:00+08:00',
  },
  {
    id: 'b',
    date: '2026-09-02',
    semester: '第一學期',
    subject: '清潔用品',
    category: '清潔用品',
    type: 'expense',
    amount: 700,
    handled_by: '另一位總務',
    note: '掃具',
    created_at: '2026-09-02T08:00:00+08:00',
  },
];

function transactionWith(
  id: string,
  changes: Partial<Transaction>,
): Transaction {
  return {...transactions[0], id, ...changes};
}

function filterWith(changes: Partial<LedgerFilter>): LedgerFilter {
  return {...emptyFilter, ...changes};
}

const SAFE_INTEGER_RANGE_ERROR =
  'Ledger calculation exceeds the safe integer range';

function unsafeTransactions(type: Transaction['type']): Transaction[] {
  return [
    transactionWith('safe-limit', {
      date: '2026-10-01',
      type,
      amount: Number.MAX_SAFE_INTEGER,
      created_at: '2026-10-01T08:00:00+08:00',
    }),
    transactionWith('overflow', {
      date: '2026-10-02',
      type,
      amount: 1,
      created_at: '2026-10-02T08:00:00+08:00',
    }),
  ];
}

function expectSafeIntegerRangeError(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toBe(SAFE_INTEGER_RANGE_ERROR);
    return;
  }

  throw new Error('Expected ledger calculation to reject an unsafe integer');
}

const semesterOpeningSettings: LedgerSettings = {
  schema_version: 2,
  currency: 'TWD',
  active_semester: '秋季學期',
  default_officer: '我',
  locked_semesters: [],
  semesters: [
    {value: '夏季學期', status: 'archived'},
    {value: '秋季學期', status: 'active'},
    {value: '春季學期', status: 'archived'},
  ],
  categories: [],
  officers: [],
};

function openingTransaction(
  id: string,
  semester: string,
  type: Transaction['type'],
  amount: number,
  date: string,
): Transaction {
  return transactionWith(id, {semester, type, amount, date});
}

describe('ledger chronology and running balances', () => {
  it('builds full-ledger balances in chronological order', () => {
    expect(
      buildLedgerRows(transactions).map((row) => [
        row.transaction.id,
        row.runningBalance,
      ]),
    ).toEqual([
      ['a', 5000],
      ['b', 4300],
      ['c', 4000],
    ]);
  });

  it('orders by parsed creation time and then by id', () => {
    const sameDay: Transaction[] = [
      transactionWith('z', {
        created_at: '2026-09-02T08:30:00+00:00',
      }),
      transactionWith('b', {
        created_at: '2026-09-02T09:00:00+08:00',
      }),
      transactionWith('a', {
        created_at: '2026-09-02T09:00:00+08:00',
      }),
    ];

    expect(orderTransactions(sameDay).map(({id}) => id)).toEqual([
      'a',
      'b',
      'z',
    ]);
  });

  it('orders malformed creation timestamps deterministically after valid ones', () => {
    const validEarly = transactionWith('y', {
      created_at: '2026-09-02T08:00:00+08:00',
    });
    const validLate = transactionWith('z', {
      created_at: '2026-09-02T09:00:00+08:00',
    });
    const malformedA = transactionWith('a', {
      created_at: 'invalid-later',
    });
    const malformedB = transactionWith('b', {
      created_at: 'invalid-earlier',
    });
    const permutations = [
      [malformedB, validLate, malformedA, validEarly],
      [validEarly, malformedA, validLate, malformedB],
      [malformedA, malformedB, validEarly, validLate],
    ];

    for (const permutation of permutations) {
      expect(orderTransactions(permutation).map(({id}) => id)).toEqual([
        'y',
        'z',
        'a',
        'b',
      ]);
    }
  });

  it('rejects an unsafe chronological running balance', () => {
    expectSafeIntegerRangeError(() =>
      buildLedgerRows(unsafeTransactions('income')),
    );
  });

  it('does not mutate the input while ordering or building rows', () => {
    const input = structuredClone(transactions);
    const before = structuredClone(input);

    const ordered = orderTransactions(input);
    const rows = buildLedgerRows(input);

    expect(input).toEqual(before);
    expect(ordered).not.toBe(input);
    expect(rows.map((row) => row.transaction.id)).toEqual(['a', 'b', 'c']);
  });

  it.each<{
    name: string;
    select: (input: readonly Transaction[]) => Transaction;
  }>([
    {
      name: 'ordered transaction',
      select: (input) => orderTransactions(input)[0]!,
    },
    {
      name: 'ledger row transaction',
      select: (input) => buildLedgerRows(input)[0]!.transaction,
    },
    {
      name: 'ledger view transaction',
      select: (input) =>
        createLedgerView(input, emptyFilter).rows[0]!.transaction,
    },
  ])('returns a cloned $name', ({select}) => {
    const input = structuredClone(transactions);
    const before = structuredClone(input);
    const returnedTransaction = select(input);

    returnedTransaction.subject = 'changed through result';

    expect(input).toEqual(before);
  });
});

describe('totals', () => {
  const cases: Array<{
    name: string;
    input: Transaction[];
    expected: Totals;
  }> = [
    {
      name: 'an empty ledger',
      input: [],
      expected: {income: 0, expenses: 0, net: 0},
    },
    {
      name: 'income only',
      input: [transactions[1]],
      expected: {income: 5000, expenses: 0, net: 5000},
    },
    {
      name: 'expenses only',
      input: [transactions[2], transactions[0]],
      expected: {income: 0, expenses: 1000, net: -1000},
    },
    {
      name: 'mixed transactions',
      input: transactions,
      expected: {income: 5000, expenses: 1000, net: 4000},
    },
  ];

  it.each(cases)('calculates $name', ({input, expected}) => {
    expect(calculateTotals(input)).toEqual(expected);
  });

  it.each(['income', 'expense'] as const)(
    'rejects an unsafe %s aggregate',
    (type) => {
      expectSafeIntegerRangeError(() =>
        calculateTotals(unsafeTransactions(type)),
      );
    },
  );

  it('rejects unsafe view calculations consistently across caller order', () => {
    const input = unsafeTransactions('income');

    expectSafeIntegerRangeError(() => createLedgerView(input, emptyFilter));
    expectSafeIntegerRangeError(() =>
      createLedgerView([...input].reverse(), emptyFilter),
    );
  });
});

describe('semester opening balances', () => {
  it('uses configured semester order rather than transaction input order or dates', () => {
    const input = [
      openingTransaction('spring', '春季學期', 'expense', 20, '2020-01-01'),
      openingTransaction('autumn', '秋季學期', 'income', 100, '2019-01-01'),
      openingTransaction('summer', '夏季學期', 'expense', 30, '2030-01-01'),
    ];

    expect(
      calculateSemesterOpeningBalance(semesterOpeningSettings, input, '夏季學期'),
    ).toBe(0);
    expect(
      calculateSemesterOpeningBalance(semesterOpeningSettings, input, '秋季學期'),
    ).toBe(-30);
    expect(
      calculateSemesterOpeningBalance(semesterOpeningSettings, input, '春季學期'),
    ).toBe(70);
  });

  it('recalculates from the current earlier transaction amounts', () => {
    const input = [
      openingTransaction('summer', '夏季學期', 'income', 100, '2026-07-01'),
    ];

    expect(
      calculateSemesterOpeningBalance(semesterOpeningSettings, input, '秋季學期'),
    ).toBe(100);

    input[0]!.amount = 40;

    expect(
      calculateSemesterOpeningBalance(semesterOpeningSettings, input, '秋季學期'),
    ).toBe(40);
  });

  it.each([
    {
      name: 'a positive carryover',
      input: [
        openingTransaction(
          'summer-income',
          '夏季學期',
          'income',
          50,
          '2026-07-01',
        ),
      ],
      expected: 50,
    },
    {name: 'a zero carryover', input: [], expected: 0},
    {
      name: 'a negative carryover',
      input: [
        openingTransaction(
          'summer-expense',
          '夏季學期',
          'expense',
          50,
          '2026-07-01',
        ),
      ],
      expected: -50,
    },
  ])('returns $name', ({input, expected}) => {
    expect(
      calculateSemesterOpeningBalance(
        semesterOpeningSettings,
        input,
        '秋季學期',
      ),
    ).toBe(expected);
  });

  it('rejects an unconfigured target semester', () => {
    expect(() =>
      calculateSemesterOpeningBalance(
        semesterOpeningSettings,
        [],
        '不存在的學期',
      ),
    ).toThrow(new RangeError('Semester is not configured'));
  });

  it('rejects an unsafe aggregate from an earlier semester', () => {
    expectSafeIntegerRangeError(() =>
      calculateSemesterOpeningBalance(
        semesterOpeningSettings,
        unsafeTransactions('income').map((transaction) => ({
          ...transaction,
          semester: '夏季學期',
        })),
        '秋季學期',
      ),
    );
  });

  it('does not mutate settings, transactions, or transaction objects', () => {
    const settings = structuredClone(semesterOpeningSettings);
    const input = [
      openingTransaction('summer', '夏季學期', 'income', 100, '2026-07-01'),
    ];
    const settingsBefore = structuredClone(settings);
    const inputBefore = structuredClone(input);

    calculateSemesterOpeningBalance(settings, input, '秋季學期');

    expect(settings).toEqual(settingsBefore);
    expect(input).toEqual(inputBefore);
  });

  it('does not change ledger views', () => {
    const input = [
      openingTransaction('summer', '夏季學期', 'income', 100, '2026-07-01'),
      openingTransaction('autumn', '秋季學期', 'expense', 20, '2026-08-01'),
    ];
    const before = createLedgerView(input, emptyFilter);

    calculateSemesterOpeningBalance(semesterOpeningSettings, input, '秋季學期');

    expect(createLedgerView(input, emptyFilter)).toEqual(before);
  });
});

describe('ledger filters', () => {
  const secondSemester = transactionWith('d', {
    semester: '第二學期',
  });
  const filterableTransactions = [...transactions, secondSemester];

  const cases: Array<{
    name: string;
    filter: Partial<LedgerFilter>;
    expectedIds: string[];
  }> = [
    {
      name: 'semester',
      filter: {semester: '第二學期'},
      expectedIds: ['d'],
    },
    {
      name: 'officer',
      filter: {handledBy: '另一位總務'},
      expectedIds: ['b'],
    },
    {
      name: 'category',
      filter: {category: '教材與影印'},
      expectedIds: ['c', 'd'],
    },
    {
      name: 'type',
      filter: {type: 'income'},
      expectedIds: ['a'],
    },
  ];

  it.each(cases)('applies the selected $name exactly', ({filter, expectedIds}) => {
    expect(
      filterableTransactions
        .filter((transaction) =>
          matchesFilter(transaction, filterWith(filter)),
        )
        .map(({id}) => id),
    ).toEqual(expectedIds);
  });

  it('combines selected filters with logical AND', () => {
    const matchingFilter = filterWith({
      semester: '第一學期',
      category: '清潔用品',
      handledBy: '另一位總務',
      type: 'expense',
      search: '掃具',
    });
    const conflictingFilter = {...matchingFilter, handledBy: '我'};

    expect(
      filterableTransactions
        .filter((transaction) => matchesFilter(transaction, matchingFilter))
        .map(({id}) => id),
    ).toEqual(['b']);
    expect(
      filterableTransactions.filter((transaction) =>
        matchesFilter(transaction, conflictingFilter),
      ),
    ).toEqual([]);
  });

  it('searches subject case-insensitively and matches Chinese subject text', () => {
    const searchable = transactionWith('searchable', {
      subject: 'Printer Paper 清潔',
      note: 'Room 201 掃具',
    });
    const latinFilter = filterWith({search: '  pRiNtEr  '});

    expect(matchesFilter(searchable, latinFilter)).toBe(true);
    expect(matchesFilter(searchable, filterWith({search: '清潔'}))).toBe(true);
    expect(latinFilter.search).toBe('  pRiNtEr  ');
  });

  it('searches note text', () => {
    expect(
      matchesFilter(transactions[2], filterWith({search: '掃具'})),
    ).toBe(true);
  });

  it.each([
    'search-id',
    '第二學期',
    '獨立類別',
    'Unique Officer',
    'income',
    '2026-10-01',
  ])('does not search unrelated transaction fields: %s', (query) => {
    const searchable = transactionWith('search-id', {
      date: '2026-10-01',
      semester: '第二學期',
      subject: 'Printer Paper',
      category: '獨立類別',
      type: 'income',
      handled_by: 'Unique Officer',
      note: 'Room 201',
    });

    expect(matchesFilter(searchable, filterWith({search: query}))).toBe(false);
  });

  it('treats an empty or whitespace-only search as unfiltered', () => {
    expect(matchesFilter(transactions[0], emptyFilter)).toBe(true);
    expect(
      matchesFilter(transactions[0], filterWith({search: '   '})),
    ).toBe(true);
  });

  it('keeps the shared empty filter immutable', () => {
    const mutableFilter = emptyFilter as LedgerFilter;
    const originalType = emptyFilter.type;

    try {
      const mutationResult = Reflect.set(mutableFilter, 'type', 'expense');

      expect(mutationResult).toBe(false);
      expect(Object.isFrozen(emptyFilter)).toBe(true);
      expect(
        createLedgerView(transactions, emptyFilter).rows.map(
          ({transaction}) => transaction.id,
        ),
      ).toEqual(['c', 'b', 'a']);
    } finally {
      if (!Object.isFrozen(emptyFilter)) {
        Reflect.set(mutableFilter, 'type', originalType);
      }
    }
  });
});

describe('ledger views', () => {
  it('summarizes the full unfiltered ledger', () => {
    expect(createLedgerView(transactions, emptyFilter)).toMatchObject({
      overall: {income: 5000, expenses: 1000, net: 4000},
      filtered: {income: 5000, expenses: 1000, net: 4000},
      expensesByCategory: {'清潔用品': 700, '教材與影印': 300},
    });
  });

  it('displays matching ledger rows newest first', () => {
    expect(
      createLedgerView(transactions, emptyFilter).rows.map(
        (row) => row.transaction.id,
      ),
    ).toEqual(['c', 'b', 'a']);
  });

  it('preserves full-ledger balances while totaling the filtered rows', () => {
    const view = createLedgerView(
      transactions,
      filterWith({handledBy: '我'}),
    );

    expect(
      view.rows.map((row) => [row.transaction.id, row.runningBalance]),
    ).toEqual([
      ['c', 4000],
      ['a', 5000],
    ]);
    expect(view.overall).toEqual({income: 5000, expenses: 1000, net: 4000});
    expect(view.filtered).toEqual({income: 5000, expenses: 300, net: 4700});
    expect(view.expensesByCategory).toEqual({'教材與影印': 300});
    expect(view.expensesByCategory).not.toHaveProperty('期初餘額');
  });

  it('includes only matching expense categories with positive amounts', () => {
    const categoryTransactions: Transaction[] = [
      transactionWith('valid-expense', {
        category: '有效類別',
        amount: 25,
      }),
      transactionWith('zero-expense', {
        category: '零額類別',
        amount: 0,
      }),
      transactionWith('missing-category', {
        category: '',
        amount: 50,
      }),
      transactionWith('income-category', {
        category: '收入類別',
        type: 'income',
        amount: 100,
      }),
    ];

    expect(
      createLedgerView(categoryTransactions, emptyFilter).expensesByCategory,
    ).toEqual({'有效類別': 25});
  });

  it('uses a prototype-free category map for reserved and repeated names', () => {
    const categoryTransactions: Transaction[] = [
      transactionWith('constructor-category', {
        category: 'constructor',
        amount: 100,
      }),
      transactionWith('to-string-category', {
        category: 'toString',
        amount: 200,
      }),
      transactionWith('proto-category-1', {
        category: '__proto__',
        amount: 300,
      }),
      transactionWith('proto-category-2', {
        category: '__proto__',
        amount: 50,
      }),
    ];

    const totals = createLedgerView(
      categoryTransactions,
      emptyFilter,
    ).expensesByCategory;

    expect(totals['constructor']).toBe(100);
    expect(totals['toString']).toBe(200);
    expect(totals['__proto__']).toBe(350);
    expect(totals['valueOf']).toBeUndefined();
    expect(Object.getPrototypeOf(totals)).toBeNull();
  });

  it('does not mutate transactions or filters while creating a view', () => {
    const input = structuredClone(transactions);
    const filter = filterWith({search: '  掃具  '});
    const inputBefore = structuredClone(input);
    const filterBefore = structuredClone(filter);

    createLedgerView(input, filter);

    expect(input).toEqual(inputBefore);
    expect(filter).toEqual(filterBefore);
  });
});
