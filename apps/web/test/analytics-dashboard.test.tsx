import type {ReportAnalytics} from '@class-fund/ledger/analytics';
import {render, screen, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';

vi.mock('../src/components/BalanceChart.js', () => ({
  BalanceChart: ({points}: {points: ReportAnalytics['balancePoints']}) => (
    <div data-testid="balance-chart">{points.length} points</div>
  ),
}));

vi.mock('../src/components/CategoryDoughnut.js', () => ({
  CategoryDoughnut: ({
    kind,
    slices,
  }: {
    kind: 'income' | 'expense';
    slices: ReportAnalytics['incomeCategories'];
  }) => (
    <div data-testid={`${kind}-doughnut`}>
      {slices.map((slice) => (
        <span key={slice.key}>{slice.label}</span>
      ))}
    </div>
  ),
}));

vi.mock('../src/components/SemesterComparisonChart.js', () => ({
  SemesterComparisonChart: ({
    semesters,
  }: {
    semesters: ReportAnalytics['semesters'];
  }) => <div data-testid="semester-chart">{semesters.length} semesters</div>,
}));

import {AnalyticsDashboard} from '../src/components/AnalyticsDashboard.js';

const analytics: ReportAnalytics = {
  balancePoints: [
    {
      kind: 'transaction',
      transactionId: 'printing',
      date: '2026-08-20',
      subject: '影印講義',
      signedAmount: -300,
      balance: 4700,
      matchesFilter: true,
    },
  ],
  expenseCategories: [
    {
      key: 'category:其他',
      kind: 'category',
      label: '其他',
      category: '其他',
      amount: 600,
      count: 2,
      percentage: 60,
      groupedCategories: ['其他'],
    },
    {
      key: 'remainder',
      kind: 'remainder',
      label: '其他（彙整）',
      category: '其他',
      amount: 400,
      count: 3,
      percentage: 40,
      groupedCategories: ['教材與影印', '清潔用品'],
    },
  ],
  incomeCategories: [],
  semesters: [
    {
      semester: '第一學期',
      income: 5000,
      expenses: 1000,
      openingBalance: 0,
      endingBalance: 4000,
    },
  ],
  largestTransactions: [
    {
      transactionId: 'printing',
      date: '2026-08-20',
      subject: '影印講義',
      category: '教材與影印',
      type: 'expense',
      signedAmount: -300,
    },
  ],
};

describe('AnalyticsDashboard', () => {
  it('renders the five unframed analytics regions in report order', () => {
    render(
      <AnalyticsDashboard analytics={analytics} onSelectTransaction={vi.fn()} />,
    );

    expect(
      screen
        .getAllByRole('region')
        .map((region) => region.getAttribute('aria-label')),
    ).toEqual([
      '總餘額走勢',
      '分類支出比例',
      '分類收入比例',
      '各學期收支比較',
      '主要收支變動',
    ]);
    expect(document.querySelector('.analytics-dashboard')).toBeVisible();
    expect(document.querySelectorAll('.analytics-grid')).toHaveLength(2);
  });

  it('passes refined category labels and keys through to the doughnuts', () => {
    render(
      <AnalyticsDashboard analytics={analytics} onSelectTransaction={vi.fn()} />,
    );

    const expenseRegion = screen.getByRole('region', {name: '分類支出比例'});
    expect(within(expenseRegion).getByText('其他')).toBeVisible();
    expect(within(expenseRegion).getByText('其他（彙整）')).toBeVisible();
    expect(screen.getByTestId('balance-chart')).toHaveTextContent('1 points');
    expect(screen.getByTestId('semester-chart')).toHaveTextContent(
      '1 semesters',
    );
  });
});
