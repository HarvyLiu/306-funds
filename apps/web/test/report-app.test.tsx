import {
  createLedgerView,
  emptyFilter,
  type LedgerSettings,
  type Transaction,
} from '@class-fund/ledger';
import type {
  CategorySlice,
  SemesterAnalytics,
} from '@class-fund/ledger/analytics';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const chartMocks = vi.hoisted(() => ({
  configurations: [] as unknown[],
  failNext: false,
  register: vi.fn(),
}));

vi.mock('chart.js', () => {
  const Chart = vi.fn(function (
    _canvas: HTMLCanvasElement,
    configuration: unknown,
  ) {
    if (chartMocks.failNext) {
      chartMocks.failNext = false;
      throw new Error('canvas unavailable');
    }

    chartMocks.configurations.push(configuration);
    return {destroy: vi.fn()};
  });
  Object.assign(Chart, {register: chartMocks.register});

  return {
    ArcElement: 'ArcElement',
    BarController: 'BarController',
    BarElement: 'BarElement',
    CategoryScale: 'CategoryScale',
    Chart,
    DoughnutController: 'DoughnutController',
    Legend: 'Legend',
    LineController: 'LineController',
    LineElement: 'LineElement',
    LinearScale: 'LinearScale',
    PointElement: 'PointElement',
    Tooltip: 'Tooltip',
  };
});

vi.mock('../src/components/CategoryDoughnut.js', () => ({
  CategoryDoughnut: ({
    kind,
    slices,
  }: {
    kind: 'income' | 'expense';
    slices: CategorySlice[];
  }) =>
    slices.length === 0 ? (
      <p>{kind === 'income' ? '目前沒有收入資料' : '目前沒有支出資料'}</p>
    ) : (
      <div
        role="img"
        aria-label={kind === 'income' ? '分類收入比例圖' : '分類支出比例圖'}
      >
        {slices.map((slice) => (
          <span key={slice.key} data-slice-key={slice.key}>
            {slice.label} {slice.amount} {slice.count} {slice.percentage}
          </span>
        ))}
      </div>
    ),
}));

vi.mock('../src/components/SemesterComparisonChart.js', () => ({
  SemesterComparisonChart: ({semesters}: {semesters: SemesterAnalytics[]}) =>
    semesters.length === 0 ? (
      <p>目前沒有學期資料</p>
    ) : (
      <div role="img" aria-label="各學期收支比較圖">
        {semesters.map((semester) => (
          <span key={semester.semester}>
            {semester.semester} {semester.income} {semester.expenses}{' '}
            {semester.openingBalance} {semester.endingBalance}
          </span>
        ))}
      </div>
    ),
}));

import {Chart} from 'chart.js';

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

const printingLargestButtonName =
  '2026-08-20 影印講義 教材與影印 -NT$300';
const cleaningLargestButtonName =
  '2026-08-20 教室清潔用品 清潔用品 -NT$700';

function mockReducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

function mockScrollIntoView() {
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  return scrollIntoView;
}

describe('ReportApp', () => {
  beforeEach(() => {
    vi.mocked(Chart).mockClear();
    chartMocks.configurations.length = 0;
    chartMocks.failNext = false;
  });

  afterEach(() => {
    chartMocks.failNext = false;
  });

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

    const printingRow = document.getElementById('transaction-printing');
    expect(printingRow).not.toBeNull();
    expect(within(printingRow!).getByText('2026/8/20')).toBeVisible();
    expect(within(printingRow!).getByText('教材與影印')).toBeVisible();
    expect(within(printingRow!).getByText('我')).toBeVisible();
    expect(within(printingRow!).getByText('NT$300')).toBeVisible();
    expect(within(printingRow!).getByText('NT$4,000')).toBeVisible();

    const cleaningRow = document.getElementById('transaction-cleaning');
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
    expect(
      within(screen.getByRole('table', {name: '班費交易明細'})).getByText(
        '第二學期清潔用品',
      ),
    ).toBeVisible();
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
    const balance = screen.getByRole('region', {name: '總餘額走勢'});
    expect(
      within(balance).getByRole('img', {name: '總餘額走勢圖'}),
    ).toBeVisible();
    const balanceConfiguration = chartMocks.configurations.at(-1) as {
      data: {
        datasets: Array<{
          data: number[];
          pointRadius: number[];
          pointStyle: string[];
        }>;
      };
    };
    expect(balanceConfiguration.data.datasets[0]).toMatchObject({
      data: [0, 5000, 4300, 4000],
      pointRadius: [5, 2, 2, 5],
      pointStyle: ['rectRot', 'circle', 'circle', 'rectRot'],
    });

    const expenses = screen.getByRole('region', {name: '分類支出比例'});
    expect(within(expenses).getByText(/教材與影印 300/)).toBeVisible();
    expect(within(expenses).queryByText(/清潔用品/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', {name: '分類收入比例'}),
    ).toHaveTextContent('目前沒有收入資料');

    const comparison = screen.getByRole('region', {
      name: '各學期收支比較',
    });
    expect(within(comparison).getByText('第一學期 0 300 0 4000')).toBeVisible();
    expect(
      screen.getByRole('button', {name: printingLargestButtonName}),
    ).toBeVisible();
    expect(
      screen.queryByRole('region', {name: '分類支出'}),
    ).not.toBeInTheDocument();
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

    const openingRow = document.getElementById('transaction-opening');
    const cleaningRow = document.getElementById('transaction-cleaning');
    const printingRow = document.getElementById('transaction-printing');
    expect(within(openingRow!).getAllByText('NT$5,000')).toHaveLength(2);
    expect(within(cleaningRow!).getByText('NT$4,300')).toBeVisible();
    expect(within(printingRow!).getByText('NT$4,000')).toBeVisible();
  });

  it('does not change analytics when only the transaction date order changes', async () => {
    const user = userEvent.setup();
    render(<ReportApp payload={payload} />);

    const analyticsText = () =>
      [
        '總餘額走勢',
        '分類支出比例',
        '分類收入比例',
        '各學期收支比較',
        '主要收支變動',
      ].map((name) => screen.getByRole('region', {name}).textContent);
    const before = analyticsText();

    await user.selectOptions(screen.getByLabelText('日期排序'), 'oldest');

    expect(analyticsText()).toEqual(before);
  });

  it('keeps truthful analytics and empty states usable when no transaction matches', async () => {
    const user = userEvent.setup();
    render(<ReportApp payload={payload} />);

    await user.type(
      screen.getByRole('searchbox', {name: '搜尋項目與備註'}),
      '完全不存在的交易',
    );

    expect(
      screen.getByRole('region', {name: '分類支出比例'}),
    ).toHaveTextContent('目前沒有支出資料');
    expect(
      screen.getByRole('region', {name: '分類收入比例'}),
    ).toHaveTextContent('目前沒有收入資料');
    expect(
      screen.getByRole('region', {name: '主要收支變動'}),
    ).toHaveTextContent('目前沒有符合條件的收支變動');
    const balance = screen.getByRole('region', {name: '總餘額走勢'});
    await user.click(within(balance).getByRole('button', {name: '查看資料表'}));
    expect(within(balance).getByText('期初班費')).toBeVisible();
    expect(
      screen.getByRole('table', {name: '班費交易明細'}),
    ).toHaveTextContent('沒有符合篩選條件的交易');
  });

  it('keeps the report usable when one Chart constructor fails', async () => {
    chartMocks.failNext = true;
    render(<ReportApp payload={payload} />);

    expect(
      await screen.findByText('圖表無法顯示，請查看資料表'),
    ).toHaveAttribute('role', 'status');
    const summary = screen.getByRole('region', {name: '帳務摘要'});
    expect(within(summary).getByText('NT$4,000')).toBeVisible();
    const transactionsTable = screen.getByRole('table', {
      name: '班費交易明細',
    });
    expect(within(transactionsTable).getByText('影印講義')).toBeVisible();
    expect(
      within(screen.getByRole('region', {name: '總餘額走勢'})).getByRole(
        'button',
        {name: '查看資料表'},
      ),
    ).toBeVisible();
  });

  it('focuses and highlights a row from the largest list with smooth scrolling', async () => {
    const user = userEvent.setup();
    const scrollIntoView = mockScrollIntoView();
    mockReducedMotion(false);
    render(<ReportApp payload={payload} />);

    const button = screen.getByRole('button', {
      name: printingLargestButtonName,
    });
    button.focus();
    await user.keyboard('{Enter}');

    const row = document.getElementById('transaction-printing');
    expect(row).toHaveFocus();
    expect(row).toHaveClass('transaction-highlight');
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      behavior: 'smooth',
    });
  });

  it('uses non-smooth row navigation when reduced motion is requested', async () => {
    const user = userEvent.setup();
    const scrollIntoView = mockScrollIntoView();
    mockReducedMotion(true);
    render(<ReportApp payload={payload} />);

    await user.click(
      screen.getByRole('button', {name: cleaningLargestButtonName}),
    );

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      behavior: 'auto',
    });
  });

  it('replaces an active highlight timer and clears the replacement on unmount', () => {
    vi.useFakeTimers();
    const clearTimeout = vi.spyOn(window, 'clearTimeout');
    mockScrollIntoView();
    mockReducedMotion(false);
    const {unmount} = render(<ReportApp payload={payload} />);
    const printingButton = screen.getByRole('button', {
      name: printingLargestButtonName,
    });
    const cleaningButton = screen.getByRole('button', {
      name: cleaningLargestButtonName,
    });
    const printingRow = document.getElementById('transaction-printing');
    const cleaningRow = document.getElementById('transaction-cleaning');

    fireEvent.click(printingButton);
    expect(printingRow).toHaveClass('transaction-highlight');
    act(() => vi.advanceTimersByTime(1000));

    fireEvent.click(cleaningButton);
    expect(printingRow).not.toHaveClass('transaction-highlight');
    expect(cleaningRow).toHaveClass('transaction-highlight');
    expect(clearTimeout).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(600));
    expect(cleaningRow).toHaveClass('transaction-highlight');
    act(() => vi.advanceTimersByTime(999));
    expect(cleaningRow).toHaveClass('transaction-highlight');
    act(() => vi.advanceTimersByTime(1));
    expect(cleaningRow).not.toHaveClass('transaction-highlight');

    fireEvent.click(printingButton);
    unmount();
    expect(clearTimeout).toHaveBeenCalledTimes(2);

    clearTimeout.mockRestore();
    vi.useRealTimers();
  });
});
