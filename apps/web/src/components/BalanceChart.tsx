import type {BalancePoint} from '@class-fund/ledger/analytics';
import {formatSignedTwd, formatTwd} from '@class-fund/ledger/format';
import type {ChartConfiguration} from 'chart.js';
import {useCallback, useEffect, useMemo, useState} from 'react';

import {ChartDataTable} from './ChartDataTable.js';
import './chart-palette.js';
import {useChart} from './use-chart.js';

interface BalanceChartProps {
  points: BalancePoint[];
}

interface BalanceTableRow {
  key: string;
  date: string;
  subject: string;
  change: string;
  balance: string;
  filterMatch: string;
}

const columns = [
  {key: 'date' as const, heading: '日期'},
  {key: 'subject' as const, heading: '項目'},
  {key: 'change' as const, heading: '變動', align: 'right' as const},
  {key: 'balance' as const, heading: '結果餘額', align: 'right' as const},
  {key: 'filterMatch' as const, heading: '篩選狀態'},
];

function chartLabel(point: BalancePoint): string {
  return point.kind === 'opening'
    ? '期初結餘'
    : `${point.date ?? ''} ${point.subject}`.trim();
}

function formatBalanceChange(amount: number | null): string {
  if (amount === null) {
    return '期初結餘';
  }

  return formatSignedTwd(amount);
}

function liveDetail(point: BalancePoint): string {
  if (point.kind === 'opening') {
    return `期初結餘，餘額 ${formatTwd(point.balance)}`;
  }

  return `${chartLabel(point)} ${formatBalanceChange(point.signedAmount)}，餘額 ${formatTwd(point.balance)}`;
}

export function BalanceChart({points}: BalanceChartProps) {
  const [chartError, setChartError] = useState(false);
  const [detail, setDetail] = useState('');
  const configuration = useMemo<ChartConfiguration<'line'>>(
    () => ({
      type: 'line',
      data: {
        labels: points.map(chartLabel),
        datasets: [
          {
            label: '實際總餘額',
            data: points.map(({balance}) => balance),
            borderColor: '#1d4ed8',
            backgroundColor: '#1d4ed8',
            borderWidth: 2,
            tension: 0,
            pointRadius: points.map((point) =>
              point.matchesFilter ? 5 : 2,
            ),
            pointHoverRadius: points.map((point) =>
              point.matchesFilter ? 7 : 4,
            ),
            pointStyle: points.map((point) =>
              point.matchesFilter ? 'rectRot' : 'circle',
            ),
          },
        ],
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        responsive: true,
        plugins: {
          legend: {display: false},
          tooltip: {
            callbacks: {
              title: (items) => {
                const point = points[items[0]?.dataIndex ?? -1];
                return point === undefined ? '' : chartLabel(point);
              },
              label: (item) => {
                const point = points[item.dataIndex];
                return point === undefined
                  ? ''
                  : formatBalanceChange(point.signedAmount);
              },
              afterLabel: (item) => {
                const point = points[item.dataIndex];
                return point === undefined
                  ? ''
                  : `餘額 ${formatTwd(point.balance)}`;
              },
            },
            external: ({tooltip}) => {
              const point = points[tooltip.dataPoints[0]?.dataIndex ?? -1];
              setDetail(
                tooltip.opacity === 0 || point === undefined
                  ? ''
                  : liveDetail(point),
              );
            },
          },
        },
      },
    }),
    [points],
  );
  const handleChartError = useCallback(() => setChartError(true), []);

  useEffect(() => {
    setChartError(false);
    setDetail('');
  }, [configuration]);

  const canvasRef = useChart(configuration, handleChartError);
  const rows: BalanceTableRow[] = points.map((point) => ({
    key: point.transactionId ?? 'opening',
    date: point.date ?? '—',
    subject: point.subject,
    change: formatBalanceChange(point.signedAmount),
    balance: formatTwd(point.balance),
    filterMatch: point.matchesFilter
      ? '符合目前篩選'
      : '不符合目前次要篩選',
  }));

  return (
    <div className="analytics-chart">
      {points.length === 0 ? (
        <p className="analytics-empty">目前沒有餘額資料</p>
      ) : (
        <>
          <div className="chart-stage chart-stage-balance">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="總餘額走勢圖"
              aria-hidden={chartError ? true : undefined}
            />
          </div>
          {chartError ? (
            <p className="chart-error" role="status">
              圖表無法顯示，請查看資料表
            </p>
          ) : null}
          <output className="chart-detail" aria-live="polite">
            {detail}
          </output>
        </>
      )}
      <ChartDataTable label="總餘額走勢資料" columns={columns} rows={rows} />
    </div>
  );
}
