import type {CategorySlice} from '@class-fund/ledger/analytics';
import {formatTwd} from '@class-fund/ledger/format';
import type {ChartConfiguration} from 'chart.js';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {ChartDataTable} from './ChartDataTable.js';
import {categoryColors} from './chart-palette.js';
import {useChart} from './use-chart.js';

interface CategoryDoughnutProps {
  kind: 'income' | 'expense';
  slices: CategorySlice[];
}

interface CategoryTableRow {
  key: string;
  category: string;
  amount: string;
  percentage: string;
  count: string;
  includedCategories: string;
}

const columns = [
  {key: 'category' as const, heading: '分類'},
  {key: 'amount' as const, heading: '金額', align: 'right' as const},
  {key: 'percentage' as const, heading: '百分比', align: 'right' as const},
  {key: 'count' as const, heading: '筆數', align: 'right' as const},
  {key: 'includedCategories' as const, heading: '包含分類'},
];

export function CategoryDoughnut({kind, slices}: CategoryDoughnutProps) {
  const [chartError, setChartError] = useState(false);
  const configuration = useMemo<ChartConfiguration<'doughnut'>>(
    () => ({
      type: 'doughnut',
      data: {
        labels: slices.map(({label}) => label),
        datasets: [
          {
            data: slices.map(({amount}) => amount),
            backgroundColor: slices.map(
              (_, index) => categoryColors[index % categoryColors.length],
            ),
            borderWidth: 0,
          },
        ],
      },
      options: {
        animation: false,
        cutout: '62%',
        maintainAspectRatio: false,
        responsive: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {boxWidth: 10, boxHeight: 10},
          },
          tooltip: {
            callbacks: {
              label: (item) => {
                const slice = slices[item.dataIndex];
                return slice === undefined
                  ? ''
                  : `${slice.label}：${formatTwd(slice.amount)}，${slice.percentage}%，${slice.count} 筆`;
              },
            },
          },
        },
      },
    }),
    [slices],
  );
  const handleChartError = useCallback(() => setChartError(true), []);

  useEffect(() => {
    setChartError(false);
  }, [configuration]);

  const canvasRef = useChart(configuration, handleChartError);
  const isIncome = kind === 'income';
  const rows: CategoryTableRow[] = slices.map((slice) => ({
    key: slice.key,
    category: slice.label,
    amount: formatTwd(slice.amount),
    percentage: `${slice.percentage}%`,
    count: `${slice.count} 筆`,
    includedCategories: slice.groupedCategories.join('、'),
  }));

  return (
    <div className="analytics-chart">
      {slices.length === 0 ? (
        <p className="analytics-empty">
          {isIncome ? '目前沒有收入資料' : '目前沒有支出資料'}
        </p>
      ) : (
        <div className="chart-stage chart-stage-doughnut">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={isIncome ? '分類收入比例圖' : '分類支出比例圖'}
            aria-hidden={chartError ? true : undefined}
          />
        </div>
      )}
      {chartError ? (
        <p className="chart-error" role="status">
          圖表無法顯示，請查看資料表
        </p>
      ) : null}
      <ChartDataTable
        label={isIncome ? '分類收入比例資料' : '分類支出比例資料'}
        columns={columns}
        rows={rows}
      />
    </div>
  );
}
