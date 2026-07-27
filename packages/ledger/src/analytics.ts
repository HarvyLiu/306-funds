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
  key: string;
  kind: 'category' | 'remainder';
  label: string;
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

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

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

function roundPercentage(amount: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((amount / total) * 1000) / 10),
  );
}

function categorySlices(
  transactions: readonly Transaction[],
  type: TransactionType,
): CategorySlice[] {
  const groups = new Map<string, {amount: number; count: number}>();

  for (const transaction of transactions) {
    if (transaction.type !== type || transaction.amount <= 0) {
      continue;
    }

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
  const slices: CategorySlice[] = visible.map(([category, value]) => ({
    key: `category:${category}`,
    kind: 'category',
    label: category,
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
      key: 'remainder',
      kind: 'remainder',
      label: '其他（彙整）',
      category: '其他',
      amount: other.amount,
      count: other.count,
      percentage: roundPercentage(other.amount, total),
      groupedCategories: other.categories,
    });
  }

  return slices;
}

function semesterAnalytics(
  settings: LedgerSettings,
  transactions: readonly Transaction[],
  filter: LedgerFilter,
): SemesterAnalytics[] {
  const configured = settings.semesters
    .map((option) => option.value)
    .filter(
      (semester) => filter.semester === null || semester === filter.semester,
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

function largestTransactions(
  transactions: readonly Transaction[],
): LargestTransaction[] {
  return [...transactions]
    .sort((left, right) => {
      const amountOrder = Math.abs(right.amount) - Math.abs(left.amount);
      if (amountOrder !== 0) {
        return amountOrder;
      }

      const dateOrder = compareText(right.date, left.date);
      if (dateOrder !== 0) {
        return dateOrder;
      }

      const leftCreationTime = Date.parse(left.created_at);
      const rightCreationTime = Date.parse(right.created_at);
      const leftHasValidCreationTime = Number.isFinite(leftCreationTime);
      const rightHasValidCreationTime = Number.isFinite(rightCreationTime);

      if (leftHasValidCreationTime && rightHasValidCreationTime) {
        const creationOrder = rightCreationTime - leftCreationTime;
        if (creationOrder !== 0) {
          return creationOrder;
        }
      } else if (leftHasValidCreationTime !== rightHasValidCreationTime) {
        return leftHasValidCreationTime ? -1 : 1;
      }

      return compareText(left.id, right.id);
    })
    .slice(0, 5)
    .map((transaction) => ({
      transactionId: transaction.id,
      date: transaction.date,
      subject: transaction.subject,
      category: transaction.category,
      type: transaction.type,
      signedAmount:
        transaction.type === 'income'
          ? transaction.amount
          : -transaction.amount,
    }));
}

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
