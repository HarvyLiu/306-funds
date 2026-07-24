import type {
  LedgerFilter,
  LedgerRow,
  LedgerView,
  Totals,
  Transaction,
} from './types.js';

export const emptyFilter: Readonly<LedgerFilter> = Object.freeze({
  semester: null,
  category: null,
  handledBy: null,
  type: null,
  search: '',
});

const SAFE_INTEGER_RANGE_ERROR =
  'Ledger calculation exceeds the safe integer range';

function addSafeInteger(left: number, right: number): number {
  const result = left + right;

  if (!Number.isSafeInteger(result)) {
    throw new RangeError(SAFE_INTEGER_RANGE_ERROR);
  }

  return result;
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

export function orderTransactions(
  transactions: readonly Transaction[],
): Transaction[] {
  return [...transactions]
    .sort((left, right) => {
      const dateOrder = compareText(left.date, right.date);
      if (dateOrder !== 0) {
        return dateOrder;
      }

      const leftCreationTime = Date.parse(left.created_at);
      const rightCreationTime = Date.parse(right.created_at);
      const leftHasValidCreationTime = Number.isFinite(leftCreationTime);
      const rightHasValidCreationTime = Number.isFinite(rightCreationTime);

      if (leftHasValidCreationTime && rightHasValidCreationTime) {
        const creationOrder = leftCreationTime - rightCreationTime;
        if (creationOrder !== 0) {
          return creationOrder;
        }
      } else if (leftHasValidCreationTime !== rightHasValidCreationTime) {
        return leftHasValidCreationTime ? -1 : 1;
      }

      return compareText(left.id, right.id);
    })
    .map((transaction) => ({...transaction}));
}

export function buildLedgerRows(
  transactions: readonly Transaction[],
): LedgerRow[] {
  let runningBalance = 0;

  return orderTransactions(transactions).map((transaction) => {
    runningBalance = addSafeInteger(
      runningBalance,
      transaction.type === 'income' ? transaction.amount : -transaction.amount,
    );

    return {transaction, runningBalance};
  });
}

export function calculateTotals(
  transactions: readonly Transaction[],
): Totals {
  let income = 0;
  let expenses = 0;

  for (const transaction of transactions) {
    if (transaction.type === 'income') {
      income = addSafeInteger(income, transaction.amount);
    } else {
      expenses = addSafeInteger(expenses, transaction.amount);
    }
  }

  return {income, expenses, net: addSafeInteger(income, -expenses)};
}

export function matchesFilter(
  transaction: Transaction,
  filter: LedgerFilter,
): boolean {
  if (
    (filter.semester !== null &&
      transaction.semester !== filter.semester) ||
    (filter.category !== null &&
      transaction.category !== filter.category) ||
    (filter.handledBy !== null &&
      transaction.handled_by !== filter.handledBy) ||
    (filter.type !== null && transaction.type !== filter.type)
  ) {
    return false;
  }

  const query = filter.search.trim().toLowerCase();
  if (query === '') {
    return true;
  }

  return (
    transaction.subject.toLowerCase().includes(query) ||
    transaction.note.toLowerCase().includes(query)
  );
}

export function createLedgerView(
  transactions: readonly Transaction[],
  filter: LedgerFilter,
): LedgerView {
  const fullLedgerRows = buildLedgerRows(transactions);
  const matchingRows = fullLedgerRows.filter(({transaction}) =>
    matchesFilter(transaction, filter),
  );
  const matchingTransactions = matchingRows.map(({transaction}) => transaction);
  const expensesByCategory = Object.create(null) as Record<string, number>;

  for (const transaction of matchingTransactions) {
    if (
      transaction.type !== 'expense' ||
      transaction.amount <= 0 ||
      transaction.category.trim() === ''
    ) {
      continue;
    }

    expensesByCategory[transaction.category] = addSafeInteger(
      expensesByCategory[transaction.category] ?? 0,
      transaction.amount,
    );
  }

  return {
    rows: [...matchingRows].reverse(),
    overall: calculateTotals(transactions),
    filtered: calculateTotals(matchingTransactions),
    expensesByCategory,
  };
}
