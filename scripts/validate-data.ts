import {resolve} from 'node:path';

import {calculateTotals} from '@class-fund/ledger';
import {LedgerRepository} from '@class-fund/ledger/node';

const root = resolve(process.cwd());
const repository = await LedgerRepository.open(root);
const state = repository.getState();
const totals = calculateTotals(state.transactions);

console.log(
  JSON.stringify({
    transactions: state.transactions.length,
    income: totals.income,
    expenses: totals.expenses,
    balance: totals.net,
  }),
);
