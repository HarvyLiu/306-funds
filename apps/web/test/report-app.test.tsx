import {
  createLedgerView,
  emptyFilter,
  type LedgerSettings,
  type Transaction,
} from '@class-fund/ledger';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';

vi.mock('chart.js', () => {
  class Chart {
    static register() {}

    destroy() {}
  }

  return {
    BarController: 'BarController',
    BarElement: 'BarElement',
    CategoryScale: 'CategoryScale',
    Chart,
    LinearScale: 'LinearScale',
    Tooltip: 'Tooltip',
  };
});

import {ReportApp} from '../src/components/ReportApp.js';
import type {ReportPayload} from '../src/lib/load-report.js';

const settings: LedgerSettings = {
  schema_version: 2,
  currency: 'TWD',
  active_semester: '第一學期',
  default_officer: '我',
  locked_semesters: [],
  semesters: [
    {value: '第一學期', status: 'active'},
    {value: '第二學期', status: 'active'},
  ],
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
    subject: '教室清潔用品',
    category: '清潔用品',
    type: 'expense',
    amount: 700,
    handled_by: '另一位總務',
    note: '掃具與抹布',
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

const secondSemesterTransaction: Transaction = {
  id: 'second-semester-cleaning',
  date: '2027-02-20',
  semester: '第二學期',
  subject: '第二學期清潔用品',
  category: '清潔用品',
  type: 'expense',
  amount: 600,
  handled_by: '另一位總務',
  note: '',
  created_at: '2027-02-20T08:00:00+08:00',
};

const secondSemesterPayload: ReportPayload = {
  ...payload,
  transactions: [...transactions, secondSemesterTransaction],
  view: createLedgerView([...transactions, secondSemesterTransaction], {
    ...emptyFilter,
  }),
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

    const cleaningRow = screen.getByText('教室清潔用品').closest('tr');
    expect(cleaningRow).not.toBeNull();
    expect(within(cleaningRow!).getByText('NT$700')).toBeVisible();
    expect(within(cleaningRow!).getByText('NT$4,300')).toBeVisible();

    const subjects = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('.subject')?.textContent);
    expect(subjects).toEqual(['影印講義', '教室清潔用品', '期初班費']);
    expect(
      within(table).queryByRole('row', {name: /期初結餘/}),
    ).not.toBeInTheDocument();
  });

  it('shows a zero opening balance before first-semester transactions', async () => {
    const user = userEvent.setup();
    render(<ReportApp payload={payload} />);

    await user.selectOptions(screen.getByLabelText('學期'), '第一學期');

    const table = screen.getByRole('table', {name: '班費交易明細'});
    const opening = within(table).getByRole('row', {
      name: '第一學期 期初結餘 NT$0',
    });
    expect(within(opening).getByText('期初結餘')).toBeVisible();
    expect(within(opening).getByText('本學期開始前的累計餘額')).toBeVisible();
    expect(within(opening).getByText('NT$0')).toBeVisible();
    const openingCells = [
      ...opening.querySelectorAll<HTMLTableCellElement>(':scope > td'),
    ];
    expect(openingCells).toHaveLength(3);
    expect(openingCells.map(({colSpan}) => colSpan)).toEqual([5, 1, 1]);
    expect(openingCells[1]).toHaveAttribute('aria-hidden', 'true');
    expect(openingCells[1]).toBeEmptyDOMElement();
    expect(openingCells[2]).toHaveTextContent(/^NT\$0$/);
    expect(
      openingCells.reduce((total, {colSpan}) => total + colSpan, 0),
    ).toBe(7);
    expect(table.querySelector('tbody tr')).toBe(opening);
    expect(screen.getByText('3 筆交易')).toBeVisible();
  });

  it('shows the earlier-semester balance before second-semester transactions', async () => {
    const user = userEvent.setup();
    render(<ReportApp payload={secondSemesterPayload} />);

    await user.selectOptions(screen.getByLabelText('學期'), '第二學期');

    const table = screen.getByRole('table', {name: '班費交易明細'});
    const opening = within(table).getByRole('row', {
      name: '第二學期 期初結餘 NT$4,000',
    });
    expect(table.querySelector('tbody tr')).toBe(opening);
    expect(within(table).getByText('第二學期清潔用品')).toBeVisible();
    expect(screen.getByText('1 筆交易')).toBeVisible();

    await user.selectOptions(screen.getByLabelText('日期排序'), 'oldest');
    expect(table.querySelector('tbody tr')).toBe(opening);
  });

  it('keeps the semester opening when secondary filters match no transactions', async () => {
    const user = userEvent.setup();
    render(<ReportApp payload={payload} />);

    await user.selectOptions(screen.getByLabelText('學期'), '第一學期');
    await user.selectOptions(screen.getByLabelText('分類'), '清潔用品');
    await user.selectOptions(screen.getByLabelText('類型'), 'income');

    const table = screen.getByRole('table', {name: '班費交易明細'});
    expect(
      within(table).getByRole('row', {
        name: '第一學期 期初結餘 NT$0',
      }),
    ).toBeVisible();
    expect(within(table).getByText('沒有符合篩選條件的交易')).toBeVisible();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('keeps public history visible for a locked semester', async () => {
    const user = userEvent.setup();
    render(
      <ReportApp
        payload={{
          ...secondSemesterPayload,
          settings: {...settings, locked_semesters: ['第二學期']},
        }}
      />,
    );

    await user.selectOptions(screen.getByLabelText('學期'), '第二學期');

    expect(
      screen.getByRole('row', {name: '第二學期 期初結餘 NT$4,000'}),
    ).toBeVisible();
    expect(screen.getByText('第二學期清潔用品')).toBeVisible();
  });

  it('filters the report while preserving the full-ledger balance', async () => {
    const user = userEvent.setup();
    render(<ReportApp payload={payload} />);

    await user.selectOptions(screen.getByLabelText('學期'), '第一學期');
    await user.selectOptions(screen.getByLabelText('經手人'), '我');
    await user.selectOptions(screen.getByLabelText('分類'), '教材與影印');
    await user.selectOptions(screen.getByLabelText('類型'), 'expense');

    const filteredSummary = screen.getByRole('region', {name: '篩選結果'});
    expect(within(filteredSummary).getByText('篩選淨額')).toBeVisible();
    expect(within(filteredSummary).getByText('-NT$300')).toBeVisible();

    const overallSummary = screen.getByRole('region', {name: '帳務摘要'});
    expect(within(overallSummary).getByText('目前總餘額')).toBeVisible();
    expect(within(overallSummary).getByText('NT$4,000')).toBeVisible();

    const table = screen.getByRole('table', {name: '班費交易明細'});
    expect(within(table).getByText('影印講義')).toBeVisible();
    expect(within(table).queryByText('教室清潔用品')).not.toBeInTheDocument();
    const chartTotals = screen.getByRole('list', {name: '各分類支出金額'});
    expect(within(chartTotals).getByText('教材與影印')).toBeVisible();
    expect(within(chartTotals).getByText('NT$300')).toBeVisible();
    expect(within(chartTotals).queryByText('清潔用品')).not.toBeInTheDocument();
  });

  it('searches notes, clears all controls, and reverses date order without changing balances', async () => {
    const user = userEvent.setup();
    render(<ReportApp payload={payload} />);

    const search = screen.getByRole('searchbox', {name: '搜尋項目與備註'});
    await user.type(search, '掃具');

    const table = screen.getByRole('table', {name: '班費交易明細'});
    expect(within(table).getByText('教室清潔用品')).toBeVisible();
    expect(within(table).queryByText('影印講義')).not.toBeInTheDocument();

    await user.clear(search);
    await user.selectOptions(screen.getByLabelText('學期'), '第一學期');
    await user.selectOptions(screen.getByLabelText('經手人'), '我');
    await user.selectOptions(screen.getByLabelText('分類'), '教材與影印');
    await user.selectOptions(screen.getByLabelText('類型'), 'expense');

    await user.selectOptions(screen.getByLabelText('學期'), '');
    await user.selectOptions(screen.getByLabelText('經手人'), '');
    await user.selectOptions(screen.getByLabelText('分類'), '');
    await user.selectOptions(screen.getByLabelText('類型'), '');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByRole('region', {name: '篩選結果'})).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('日期排序'), 'oldest');
    const subjects = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('.subject')?.textContent);
    expect(subjects).toEqual(['期初班費', '教室清潔用品', '影印講義']);

    const openingRow = screen.getByText('期初班費').closest('tr');
    const cleaningRow = screen.getByText('教室清潔用品').closest('tr');
    const printingRow = screen.getByText('影印講義').closest('tr');
    expect(within(openingRow!).getAllByText('NT$5,000')).toHaveLength(2);
    expect(within(cleaningRow!).getByText('NT$4,300')).toBeVisible();
    expect(within(printingRow!).getByText('NT$4,000')).toBeVisible();
  });
});
