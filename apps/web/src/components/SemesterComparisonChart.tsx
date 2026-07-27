import type {SemesterAnalytics} from '@class-fund/ledger/analytics';
import {formatTwd} from '@class-fund/ledger/format';
import type {ChartConfiguration} from 'chart.js';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {ChartDataTable} from './ChartDataTable.js';
import './chart-palette.js';
import {useChart} from './use-chart.js';

interface SemesterComparisonChartProps {
  semesters: SemesterAnalytics[];
}

interface SemesterTableRow {
  key: string;
  semester: string;
  income: string;
  expenses: string;
  openingBalance: string;
  endingBalance: string;
}

const columns = [
  {key: 'semester' as const, heading: '學期'},
  {key: 'income' as const, heading: '篩選收入', align: 'right' as const},
  {key: 'expenses' as const, heading: '篩選支出', align: 'right' as const},
  {
    key: 'openingBalance' as const,
    heading: '實際期初結餘',
    align: 'right' as const,
  },
  {
    key: 'endingBalance' as const,
    heading: '實際期末結餘',
    align: 'right' as const,
  },
];

export function SemesterComparisonChart({
  semesters,
}: SemesterComparisonChartProps) {
  const [chartError, setChartError] = useState(false);
  const configuration = useMemo<
    ChartConfiguration<'bar' | 'line', number[], string>
  >(
    () => ({
      type: 'bar',
      data: {
        labels: semesters.map(({semester}) => semester),
        datasets: [
          {
            type: 'bar',
            label: '篩選收入',
            data: semesters.map(({income}) => income),
            backgroundColor: '#13795b',
            yAxisID: 'activity',
          },
          {
            type: 'bar',
            label: '篩選支出',
            data: semesters.map(({expenses}) => expenses),
            backgroundColor: '#b42318',
            yAxisID: 'activity',
          },
          {
            type: 'line',
            label: '實際期初結餘',
            data: semesters.map(({openingBalance}) => openingBalance),
            borderColor: '#62666d',
            backgroundColor: '#62666d',
            pointStyle: 'rectRot',
            fill: false,
            tension: 0,
            yAxisID: 'balance',
          },
          {
            type: 'line',
            label: '實際期末結餘',
            data: semesters.map(({endingBalance}) => endingBalance),
            borderColor: '#1d4ed8',
            backgroundColor: '#1d4ed8',
            pointStyle: 'circle',
            fill: false,
            tension: 0,
            yAxisID: 'balance',
          },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        plugins: {
          legend: {position: 'bottom'},
          tooltip: {
            callbacks: {
              label: (item) =>
                `${item.dataset.label ?? ''}：${formatTwd(item.parsed.y ?? 0)}`,
            },
          },
        },
        scales: {
          activity: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
          },
          balance: {
            type: 'linear',
            position: 'right',
            grid: {drawOnChartArea: false},
          },
        },
      },
    }),
    [semesters],
  );
  const handleChartError = useCallback(() => setChartError(true), []);

  useEffect(() => {
    setChartError(false);
  }, [configuration]);

  const canvasRef = useChart(configuration, handleChartError);
  const rows: SemesterTableRow[] = semesters.map((semester) => ({
    key: semester.semester,
    semester: semester.semester,
    income: formatTwd(semester.income),
    expenses: formatTwd(semester.expenses),
    openingBalance: formatTwd(semester.openingBalance),
    endingBalance: formatTwd(semester.endingBalance),
  }));

  return (
    <div className="analytics-chart">
      {semesters.length === 0 ? (
        <p className="analytics-empty">目前沒有學期資料</p>
      ) : (
        <div className="chart-stage">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="各學期收支比較圖"
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
        label="各學期收支比較資料"
        columns={columns}
        rows={rows}
      />
    </div>
  );
}
