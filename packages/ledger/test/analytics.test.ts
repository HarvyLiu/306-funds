import {describe, expect, test} from 'vitest';

import {createReportAnalytics} from '../src/analytics.js';
import {emptyFilter} from '../src/calculations.js';
import type {
  LedgerFilter,
  LedgerSettings,
  Transaction,
  TransactionType,
} from '../src/types.js';
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

function transaction(
  id: string,
  type: TransactionType,
  category: string,
  amount: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    date: '2026-08-01',
    semester: '第一學期',
    subject: id,
    category,
    type,
    amount,
    handled_by: '我',
    note: '',
    created_at: '2026-08-01T08:00:00+08:00',
    ...overrides,
  };
}

function expense(
  id: string,
  category: string,
  amount: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return transaction(id, 'expense', category, amount, overrides);
}

function income(
  id: string,
  category: string,
  amount: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return transaction(id, 'income', category, amount, overrides);
}

function settingsFor(input: readonly Transaction[]): LedgerSettings {
  const categories = [...new Set(input.map(({category}) => category))].map(
    (value) => ({value, status: 'active' as const}),
  );

  return {...structuredClone(validSettings), categories};
}

const creationTieTransactions: Transaction[] = [
  expense('id-b', '支出', 500, {
    date: '2026-09-01',
    created_at: 'also-invalid',
  }),
  income('newer-created', '收入', 500, {
    date: '2026-09-01',
    created_at: '2026-09-01T10:00:00+08:00',
  }),
  expense('older-created', '支出', 500, {
    date: '2026-09-01',
    created_at: '2026-09-01T09:00:00+08:00',
  }),
  income('id-a', '收入', 500, {
    date: '2026-09-01',
    created_at: 'not-a-date',
  }),
];

const largestTieTransactions: Transaction[] = [
  expense('filtered-out', '支出', 5000, {
    handled_by: '另一位總務',
  }),
  ...creationTieTransactions,
  expense('largest', '支出', 900, {
    date: '2026-08-01',
  }),
  expense('newer-date', '支出', 500, {
    date: '2026-09-02',
  }),
  income('too-small', '收入', 100, {
    date: '2026-10-01',
  }),
];

describe('balance timeline', () => {
  test('creates chronological true-balance points with stable same-day order', () => {
    const analytics = createReportAnalytics(
      validSettings,
      transactions,
      {...emptyFilter},
    );

    expect(analytics.balancePoints).toEqual([
      expect.objectContaining({
        transactionId: 'fall-income',
        signedAmount: 5000,
        balance: 5000,
      }),
      expect.objectContaining({
        transactionId: 'fall-cleaning',
        signedAmount: -700,
        balance: 4300,
      }),
      expect.objectContaining({
        transactionId: 'fall-printing',
        signedAmount: -300,
        balance: 4000,
      }),
      expect.objectContaining({
        transactionId: 'spring-income',
        signedAmount: 800,
        balance: 4800,
      }),
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

  test('does not mutate settings or transactions', () => {
    const settingsSnapshot = structuredClone(validSettings);
    const transactionsSnapshot = structuredClone(transactions);

    createReportAnalytics(validSettings, transactions, {
      ...emptyFilter,
      semester: '第二學期',
      search: '班費',
    });

    expect(validSettings).toEqual(settingsSnapshot);
    expect(transactions).toEqual(transactionsSnapshot);
  });
});

describe('category slices', () => {
  test('keeps income and expense categories separate', () => {
    const input = [
      income('class-fee', '班費', 1000),
      expense('printing', '教材與影印', 300),
      expense('cleaning', '清潔用品', 200),
    ];
    const analytics = createReportAnalytics(
      settingsFor(input),
      input,
      {...emptyFilter},
    );

    expect(analytics.incomeCategories).toEqual([
      {
        key: 'category:班費',
        kind: 'category',
        label: '班費',
        category: '班費',
        amount: 1000,
        count: 1,
        percentage: 100,
        groupedCategories: ['班費'],
      },
    ]);
    expect(analytics.expenseCategories.map(({category}) => category)).toEqual([
      '教材與影印',
      '清潔用品',
    ]);
  });

  test.each([
    ['income', ['班費'], []],
    ['expense', [], ['教材與影印']],
  ] as const)(
    'a %s type filter empties the opposite category list',
    (type, expectedIncome, expectedExpense) => {
      const input = [
        income('class-fee', '班費', 1000),
        expense('printing', '教材與影印', 300),
      ];
      const analytics = createReportAnalytics(settingsFor(input), input, {
        ...emptyFilter,
        type,
      });

      expect(
        analytics.incomeCategories.map(({category}) => category),
      ).toEqual(expectedIncome);
      expect(
        analytics.expenseCategories.map(({category}) => category),
      ).toEqual(expectedExpense);
    },
  );

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
      expect.objectContaining({
        key: 'category:甲',
        kind: 'category',
        label: '甲',
        category: '甲',
        amount: 600,
        count: 1,
        percentage: 27.9,
        groupedCategories: ['甲'],
      }),
      expect.objectContaining({
        key: 'category:乙',
        kind: 'category',
        label: '乙',
        category: '乙',
        amount: 500,
        count: 1,
        percentage: 23.3,
      }),
      expect.objectContaining({
        key: 'category:丙',
        kind: 'category',
        label: '丙',
        category: '丙',
        amount: 400,
        count: 1,
        percentage: 18.6,
      }),
      expect.objectContaining({
        key: 'category:丁',
        kind: 'category',
        label: '丁',
        category: '丁',
        amount: 300,
        count: 1,
        percentage: 14,
      }),
      expect.objectContaining({
        key: 'category:戊',
        kind: 'category',
        label: '戊',
        category: '戊',
        amount: 200,
        count: 1,
        percentage: 9.3,
      }),
      expect.objectContaining({
        key: 'remainder',
        kind: 'remainder',
        label: '其他（彙整）',
        category: '其他',
        amount: 150,
        count: 2,
        percentage: 7,
        groupedCategories: ['己', '庚'],
      }),
    ]);
  });

  test('distinguishes a real other category from the generated remainder', () => {
    const input = [
      expense('other', '其他', 700),
      expense('a', '甲', 600),
      expense('b', '乙', 500),
      expense('c', '丙', 400),
      expense('d', '丁', 300),
      expense('e', '戊', 200),
      expense('f', '己', 100),
    ];
    const slices = createReportAnalytics(
      settingsFor(input),
      input,
      {...emptyFilter},
    ).expenseCategories;
    const realOther = slices.find(({key}) => key === 'category:其他');
    const remainder = slices.find(({key}) => key === 'remainder');

    expect(new Set(slices.map(({key}) => key)).size).toBe(slices.length);
    expect(realOther).toEqual({
      key: 'category:其他',
      kind: 'category',
      label: '其他',
      category: '其他',
      amount: 700,
      count: 1,
      percentage: 25,
      groupedCategories: ['其他'],
    });
    expect(remainder).toEqual({
      key: 'remainder',
      kind: 'remainder',
      label: '其他（彙整）',
      category: '其他',
      amount: 300,
      count: 2,
      percentage: 10.7,
      groupedCategories: ['戊', '己'],
    });
  });

  test('orders equal category amounts by ascending code-point text', () => {
    const input = [
      expense('second', '乙', 100),
      expense('first', '甲', 100),
    ];

    expect(
      createReportAnalytics(settingsFor(input), input, {...emptyFilter})
        .expenseCategories,
    ).toEqual([
      expect.objectContaining({
        key: 'category:乙',
        kind: 'category',
        label: '乙',
        category: '乙',
        amount: 100,
        percentage: 50,
      }),
      expect.objectContaining({
        key: 'category:甲',
        kind: 'category',
        label: '甲',
        category: '甲',
        amount: 100,
        percentage: 50,
      }),
    ]);
  });

  test('reports a single category as 100 percent', () => {
    const input = [
      income('first', '班費', 100),
      income('second', '班費', 200),
    ];

    expect(
      createReportAnalytics(settingsFor(input), input, {...emptyFilter})
        .incomeCategories,
    ).toEqual([
      {
        key: 'category:班費',
        kind: 'category',
        label: '班費',
        category: '班費',
        amount: 300,
        count: 2,
        percentage: 100,
        groupedCategories: ['班費'],
      },
    ]);
  });
});

describe('semester comparison', () => {
  test('returns filtered semester bars with literal opening and ending balances', () => {
    const analytics = createReportAnalytics(validSettings, transactions, {
      ...emptyFilter,
      handledBy: '我',
    });

    expect(analytics.semesters).toEqual([
      {
        semester: '第一學期',
        income: 5000,
        expenses: 300,
        openingBalance: 0,
        endingBalance: 4000,
      },
      {
        semester: '第二學期',
        income: 800,
        expenses: 0,
        openingBalance: 4000,
        endingBalance: 4800,
      },
    ]);
  });

  test('returns one comparison entry when a semester is selected', () => {
    const analytics = createReportAnalytics(validSettings, transactions, {
      ...emptyFilter,
      semester: '第二學期',
    });

    expect(analytics.semesters).toEqual([
      {
        semester: '第二學期',
        income: 800,
        expenses: 0,
        openingBalance: 4000,
        endingBalance: 4800,
      },
    ]);
  });

  test('keeps zero and negative balances as numbers', () => {
    const input = [
      expense('fall-expense', '支出', 500),
      expense('spring-expense', '支出', 100, {
        semester: '第二學期',
        date: '2027-02-01',
      }),
    ];
    const analytics = createReportAnalytics(
      settingsFor(input),
      input,
      {...emptyFilter},
    );

    expect(analytics.semesters).toEqual([
      {
        semester: '第一學期',
        income: 0,
        expenses: 500,
        openingBalance: 0,
        endingBalance: -500,
      },
      {
        semester: '第二學期',
        income: 0,
        expenses: 100,
        openingBalance: -500,
        endingBalance: -600,
      },
    ]);
    expect(
      analytics.semesters.every(
        ({openingBalance, endingBalance}) =>
          typeof openingBalance === 'number' && typeof endingBalance === 'number',
      ),
    ).toBe(true);
  });
});

describe('largest transactions and boundaries', () => {
  test('orders largest matching transactions by amount, newest date, creation, then id', () => {
    const largest = createReportAnalytics(
      settingsFor(largestTieTransactions),
      largestTieTransactions,
      {...emptyFilter, handledBy: '我'},
    ).largestTransactions;

    expect(largest.map(({transactionId}) => transactionId)).toEqual([
      'largest',
      'newer-date',
      'newer-created',
      'older-created',
      'id-a',
    ]);
    expect(largest[0]).toEqual({
      transactionId: 'largest',
      date: '2026-08-01',
      subject: 'largest',
      category: '支出',
      type: 'expense',
      signedAmount: -900,
    });
    expect(largest[2]?.signedAmount).toBe(500);

    expect(
      createReportAnalytics(
        settingsFor(creationTieTransactions),
        creationTieTransactions,
        {...emptyFilter},
      ).largestTransactions.map(({transactionId}) => transactionId),
    ).toEqual(['newer-created', 'older-created', 'id-a', 'id-b']);
  });

  test('returns empty data-derived arrays for empty transaction input', () => {
    const analytics = createReportAnalytics(validSettings, [], {
      ...emptyFilter,
    });

    expect(analytics.balancePoints).toEqual([]);
    expect(analytics.incomeCategories).toEqual([]);
    expect(analytics.expenseCategories).toEqual([]);
    expect(analytics.largestTransactions).toEqual([]);
    expect(analytics.semesters).toEqual([
      {
        semester: '第一學期',
        income: 0,
        expenses: 0,
        openingBalance: 0,
        endingBalance: 0,
      },
      {
        semester: '第二學期',
        income: 0,
        expenses: 0,
        openingBalance: 0,
        endingBalance: 0,
      },
    ]);
  });

  test('throws the ledger range error on safe-integer overflow', () => {
    const input = [
      income('maximum', '班費', Number.MAX_SAFE_INTEGER),
      income('overflow', '班費', 1, {
        date: '2026-08-02',
      }),
    ];

    expect(() =>
      createReportAnalytics(settingsFor(input), input, {...emptyFilter}),
    ).toThrowError('Ledger calculation exceeds the safe integer range');
  });
});
