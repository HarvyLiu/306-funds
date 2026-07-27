import type {LargestTransaction} from '@class-fund/ledger/analytics';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

import {LargestTransactions} from '../src/components/LargestTransactions.js';

const largestTransactions: LargestTransaction[] = [
  {
    transactionId: 'fall-printing',
    date: '2026-08-20',
    subject: '影印講義',
    category: '教材與影印',
    type: 'expense',
    signedAmount: -300,
  },
  {
    transactionId: 'spring-income',
    date: '2027-02-01',
    subject: '補收班費',
    category: '班費',
    type: 'income',
    signedAmount: 800,
  },
];

describe('LargestTransactions', () => {
  it('renders signed transaction details as real ordered-list buttons', () => {
    render(
      <LargestTransactions
        transactions={largestTransactions}
        onSelect={vi.fn()}
      />,
    );

    const list = screen.getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(
      screen.getByRole('button', {
        name: '2026-08-20 影印講義 教材與影印 -NT$300',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: '2027-02-01 補收班費 班費 +NT$800',
      }),
    ).toBeVisible();
    expect(within(list).getByText('教材與影印')).toBeVisible();
    expect(within(list).getByText('-NT$300')).toHaveClass('amount-expense');
    expect(within(list).getByText('+NT$800')).toHaveClass('amount-income');
  });

  it('focuses and highlights the matching transaction row', async () => {
    const user = userEvent.setup();
    const focusTransaction = vi.fn();
    render(
      <LargestTransactions
        transactions={largestTransactions}
        onSelect={focusTransaction}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: '2026-08-20 影印講義 教材與影印 -NT$300',
      }),
    );

    expect(focusTransaction).toHaveBeenCalledWith('fall-printing');
  });

  it('renders a local empty state without an empty list', () => {
    render(<LargestTransactions transactions={[]} onSelect={vi.fn()} />);

    expect(
      screen.getByText('目前沒有符合條件的收支變動'),
    ).toBeVisible();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
