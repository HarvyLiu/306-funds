import {fileURLToPath} from 'node:url';

import {
  createLedgerView,
  emptyFilter,
  type LedgerSettings,
  type LedgerView,
  type Transaction,
} from '@class-fund/ledger';
import {LedgerRepository} from '@class-fund/ledger/node';

export interface ReportPayload {
  settings: LedgerSettings;
  transactions: Transaction[];
  view: LedgerView;
  generatedAt: string;
}

export async function loadReport(
  root =
    process.env.LEDGER_ROOT ??
    fileURLToPath(new URL('../../../..', import.meta.url)),
  now = () => new Date(),
): Promise<ReportPayload> {
  const repository = await LedgerRepository.open(root);
  const {settings, transactions} = repository.getState();
  const view = createLedgerView(transactions, {...emptyFilter});

  return {
    settings,
    transactions,
    view: {
      ...view,
      expensesByCategory: {...view.expensesByCategory},
    },
    generatedAt: now().toISOString(),
  };
}
