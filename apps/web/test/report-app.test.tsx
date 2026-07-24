import {
  createLedgerView,
  emptyFilter,
  type LedgerSettings,
  type Transaction,
} from '@class-fund/ledger';
import {render, screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';

import {ReportApp} from '../src/components/ReportApp.js';
import type {ReportPayload} from '../src/lib/load-report.js';

const settings: LedgerSettings = {
  schema_version: 1,
  currency: 'TWD',
  active_semester: '第一學期',
  default_officer: '我',
  semesters: [{value: '第一學期', status: 'active'}],
  categories: [
    {value: '期初餘額', status: 'active'},
    {value: '教材與影印', status: 'active'},
    {value: '清潔用品', status: 'active'},
  ],
  officers: [
    {value: '我', status: 'active'},
    {value: '另一位總務', status: 'active'},
  ],
};

const transactions: Transaction[] = [
  {
    id: 'opening',
    date: '2026-08-01',
    semester: '第一學期',
    subject: '期初班費',
    category: '期初餘額',
    type: 'income',
    amount: 5000,
    handled_by: '我',
    note: '',
    created_at: '2026-08-01T08:00:00+08:00',
  },
  {
    id: 'cleaning',
    date: '2026-08-20',
    semester: '第一學期',
    subject: '掃具',
    category: '清潔用品',
    type: 'expense',
    amount: 700,
    handled_by: '另一位總務',
    note: '教室清潔',
    created_at: '2026-08-20T08:00:00+08:00',
  },
  {
    id: 'printing',
    date: '2026-08-20',
    semester: '第一學期',
    subject: '影印講義',
    category: '教材與影印',
    type: 'expense',
    amount: 300,
    handled_by: '我',
    note: '數學',
    created_at: '2026-08-20T09:00:00+08:00',
  },
];

const payload: ReportPayload = {
  settings,
  transactions,
  view: createLedgerView(transactions, {...emptyFilter}),
  generatedAt: '2026-09-03T12:00:00.000Z',
};

describe('ReportApp', () => {
  it('renders report identity, full-ledger summary, and update timestamp', () => {
    render(<ReportApp payload={payload} />);

    expect(
      screen.getByRole('heading', {name: '班費收支報告'}),
    ).toBeVisible();
    const summary = screen.getByRole('region', {name: '帳務摘要'});
    expect(within(summary).getByText('目前總餘額')).toBeVisible();
    expect(screen.getAllByText('NT$4,000').length).toBeGreaterThan(0);
    expect(within(summary).getByText('總收入')).toBeVisible();
    expect(within(summary).getByText('NT$5,000')).toBeVisible();
    expect(within(summary).getByText('總支出')).toBeVisible();
    expect(within(summary).getByText('NT$1,000')).toBeVisible();
    expect(screen.getByText('資料更新時間')).toBeVisible();
    expect(screen.getByText('2026年9月3日 晚上8:00')).toBeVisible();
  });

  it('renders transaction details with stable full-ledger running balances', () => {
    render(<ReportApp payload={payload} />);

    const table = screen.getByRole('table', {name: '班費交易明細'});
    expect(table).toBeVisible();
    for (const heading of [
      '日期',
      '項目',
      '分類',
      '經手人',
      '金額',
      '餘額',
    ]) {
      expect(within(table).getByRole('columnheader', {name: heading})).toBeVisible();
    }

    const printingRow = screen.getByText('影印講義').closest('tr');
    expect(printingRow).not.toBeNull();
    expect(within(printingRow!).getByText('2026/8/20')).toBeVisible();
    expect(within(printingRow!).getByText('教材與影印')).toBeVisible();
    expect(within(printingRow!).getByText('我')).toBeVisible();
    expect(within(printingRow!).getByText('NT$300')).toBeVisible();
    expect(within(printingRow!).getByText('NT$4,000')).toBeVisible();

    const cleaningRow = screen.getByText('掃具').closest('tr');
    expect(cleaningRow).not.toBeNull();
    expect(within(cleaningRow!).getByText('NT$700')).toBeVisible();
    expect(within(cleaningRow!).getByText('NT$4,300')).toBeVisible();

    const subjects = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('.subject')?.textContent);
    expect(subjects).toEqual(['影印講義', '掃具', '期初班費']);
  });
});
