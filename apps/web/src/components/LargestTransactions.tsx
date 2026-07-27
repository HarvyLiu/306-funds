import type {LargestTransaction} from '@class-fund/ledger/analytics';
import {formatSignedTwd} from '@class-fund/ledger/format';

interface LargestTransactionsProps {
  transactions: LargestTransaction[];
  onSelect: (transactionId: string) => void;
}

export function LargestTransactions({
  transactions,
  onSelect,
}: LargestTransactionsProps) {
  if (transactions.length === 0) {
    return <p className="analytics-empty">目前沒有符合條件的收支變動</p>;
  }

  return (
    <ol className="largest-list">
      {transactions.map((transaction) => {
        const amount = formatSignedTwd(transaction.signedAmount);

        return (
          <li key={transaction.transactionId}>
            <button
              type="button"
              onClick={() => onSelect(transaction.transactionId)}
              aria-label={`${transaction.date} ${transaction.subject} ${transaction.category} ${amount}`}
            >
              <span>{transaction.date}</span>
              <strong>{transaction.subject}</strong>
              <small>{transaction.category}</small>
              <b
                className={
                  transaction.type === 'income'
                    ? 'amount-income'
                    : 'amount-expense'
                }
              >
                {amount}
              </b>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
