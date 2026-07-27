import type {ReportAnalytics} from '@class-fund/ledger/analytics';

import {BalanceChart} from './BalanceChart.js';
import {CategoryDoughnut} from './CategoryDoughnut.js';
import {LargestTransactions} from './LargestTransactions.js';
import {SemesterComparisonChart} from './SemesterComparisonChart.js';

interface AnalyticsDashboardProps {
  analytics: ReportAnalytics;
  onSelectTransaction: (transactionId: string) => void;
}

interface SectionHeadingProps {
  title: string;
  detail: string;
}

function SectionHeading({title, detail}: SectionHeadingProps) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      <span>{detail}</span>
    </div>
  );
}

export function AnalyticsDashboard({
  analytics,
  onSelectTransaction,
}: AnalyticsDashboardProps) {
  return (
    <div className="analytics-dashboard">
      <section
        className="analytics-section balance-section"
        aria-label="總餘額走勢"
      >
        <SectionHeading title="總餘額走勢" detail="實際累計餘額" />
        <BalanceChart points={analytics.balancePoints} />
      </section>

      <div className="analytics-grid analytics-grid-categories">
        <section className="analytics-section" aria-label="分類支出比例">
          <SectionHeading title="分類支出比例" detail="套用目前全部篩選" />
          <CategoryDoughnut kind="expense" slices={analytics.expenseCategories} />
        </section>
        <section className="analytics-section" aria-label="分類收入比例">
          <SectionHeading title="分類收入比例" detail="套用目前全部篩選" />
          <CategoryDoughnut kind="income" slices={analytics.incomeCategories} />
        </section>
      </div>

      <div className="analytics-grid analytics-grid-comparison">
        <section className="analytics-section" aria-label="各學期收支比較">
          <SectionHeading
            title="各學期收支比較"
            detail="篩選收支與實際餘額"
          />
          <SemesterComparisonChart semesters={analytics.semesters} />
        </section>
        <section className="analytics-section" aria-label="主要收支變動">
          <SectionHeading title="主要收支變動" detail="套用目前全部篩選" />
          <LargestTransactions
            transactions={analytics.largestTransactions}
            onSelect={onSelectTransaction}
          />
        </section>
      </div>
    </div>
  );
}
