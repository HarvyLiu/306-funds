import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
} from 'chart.js';
import {useEffect, useMemo, useRef} from 'react';

import {formatTwd} from '@class-fund/ledger/format';

interface ExpenseChartProps {
  values: Readonly<Record<string, number>>;
}

const categoryColors = ['#13795b', '#b42318', '#b7791f', '#0f766e', '#62666d'];

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export function ExpenseChart({values}: ExpenseChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const entries = useMemo(
    () => Object.entries(values).filter(([, amount]) => amount > 0),
    [values],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: entries.map(([category]) => category),
        datasets: [
          {
            data: entries.map(([, amount]) => amount),
            backgroundColor: entries.map(
              (_, index) => categoryColors[index % categoryColors.length],
            ),
            borderWidth: 0,
            barPercentage: 0.72,
          },
        ],
      },
      options: {
        animation: false,
        indexAxis: 'y',
        maintainAspectRatio: false,
        responsive: true,
        plugins: {
          legend: {display: false},
          tooltip: {enabled: true},
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: {color: '#d9dcdf'},
            ticks: {color: '#62666d'},
          },
          y: {
            grid: {display: false},
            ticks: {color: '#202124'},
          },
        },
      },
    });

    return () => chart.destroy();
  }, [entries]);

  return (
    <div className="expense-chart-layout">
      <div className="chart-stage">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="依分類統計支出"
        />
      </div>
      {entries.length === 0 ? (
        <p className="chart-empty">目前沒有支出資料</p>
      ) : (
        <ul className="category-totals" aria-label="各分類支出金額">
          {entries.map(([category, amount], index) => (
            <li key={category}>
              <span
                className="category-swatch"
                style={{backgroundColor: categoryColors[index % categoryColors.length]}}
                aria-hidden="true"
              />
              <span>{category}</span>
              <strong>{formatTwd(amount)}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
