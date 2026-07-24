export type OptionStatus = 'active' | 'archived';

export type TransactionType = 'income' | 'expense';

export interface LedgerOption {
  value: string;
  status: OptionStatus;
}

export interface LedgerSettings {
  schema_version: 1;
  currency: 'TWD';
  active_semester: string;
  default_officer: string;
  semesters: LedgerOption[];
  categories: LedgerOption[];
  officers: LedgerOption[];
}

export interface Transaction {
  id: string;
  date: string;
  semester: string;
  subject: string;
  category: string;
  type: TransactionType;
  amount: number;
  handled_by: string;
  note: string;
  created_at: string;
}

export type TransactionInput = Omit<Transaction, 'id' | 'created_at'>;

export interface LedgerState {
  settings: LedgerSettings;
  transactions: Transaction[];
}

export interface LedgerFilter {
  semester: string | null;
  category: string | null;
  handledBy: string | null;
  type: TransactionType | null;
  search: string;
}

export interface Totals {
  income: number;
  expenses: number;
  net: number;
}

export interface LedgerRow {
  transaction: Transaction;
  runningBalance: number;
}

export interface LedgerView {
  rows: LedgerRow[];
  overall: Totals;
  filtered: Totals;
  expensesByCategory: Record<string, number>;
}

export interface LedgerIssue {
  source: 'settings' | 'transactions';
  row?: number;
  field: string;
  value?: unknown;
  message: string;
}
