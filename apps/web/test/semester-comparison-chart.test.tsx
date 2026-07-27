import type {SemesterAnalytics} from '@class-fund/ledger/analytics';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, describe, expect, it, vi} from 'vitest';

interface ChartInstance {
  destroy: ReturnType<typeof vi.fn>;
}

const chartMocks = vi.hoisted(() => ({
  configurations: [] as unknown[],
  failNext: false,
  instances: [] as ChartInstance[],
  register: vi.fn(),
}));

vi.mock('chart.js', () => {
  const Chart = vi.fn(function (_canvas: HTMLCanvasElement, configuration: unknown) {
    if (chartMocks.failNext) {
      chartMocks.failNext = false;
      throw new Error('canvas unavailable');
    }

    const instance = {destroy: vi.fn()};
    chartMocks.configurations.push(configuration);
    chartMocks.instances.push(instance);
    return instance;
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

import {Chart} from 'chart.js';

import {SemesterComparisonChart} from '../src/components/SemesterComparisonChart.js';

const semesters: SemesterAnalytics[] = [
  {
    semester: '第一學期',
    income: 5000,
    expenses: 300,
    openingBalance: 0,
    endingBalance: 4000,
  },
  {
    semester: '第二學期',
    income: 800,
    expenses: 0,
    openingBalance: 4000,
    endingBalance: 4800,
  },
];

interface SemesterConfiguration {
  type: string;
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      type: string;
      data: number[];
      yAxisID: string;
      pointStyle?: string;
      fill?: boolean;
    }>;
  };
  options: {
    animation: boolean;
    maintainAspectRatio: boolean;
    responsive: boolean;
    plugins: {
      tooltip: {
        callbacks: {
          label: (item: {
            dataset: {label?: string};
            parsed: {y: number | null};
          }) => string;
        };
      };
    };
    scales: {
      activity: {
        type: string;
        position: string;
        beginAtZero: boolean;
      };
      balance: {
        type: string;
        position: string;
        grid: {drawOnChartArea: boolean};
      };
    };
  };
}

function capturedConfiguration(): SemesterConfiguration {
  return chartMocks.configurations.at(-1) as SemesterConfiguration;
}

describe('SemesterComparisonChart', () => {
  beforeEach(() => {
    vi.mocked(Chart).mockClear();
    chartMocks.configurations.length = 0;
    chartMocks.instances.length = 0;
    chartMocks.failNext = false;
  });

  it('renders filtered activity bars and actual balance lines', () => {
    render(<SemesterComparisonChart semesters={semesters} />);

    const canvas = screen.getByRole('img', {name: '各學期收支比較圖'});
    expect(canvas).toBeVisible();
    expect(canvas).not.toHaveAttribute('aria-hidden');
    expect(canvas.parentElement).toHaveClass('chart-stage-semesters');
    const configuration = capturedConfiguration();
    expect(configuration.type).toBe('bar');
    expect(configuration.data.labels).toEqual(['第一學期', '第二學期']);
    expect(
      configuration.data.datasets.map(({label}) => label),
    ).toEqual(['篩選收入', '篩選支出', '實際期初結餘', '實際期末結餘']);
    expect(configuration.data.datasets).toEqual([
      expect.objectContaining({
        type: 'bar',
        data: [5000, 800],
        yAxisID: 'activity',
      }),
      expect.objectContaining({
        type: 'bar',
        data: [300, 0],
        yAxisID: 'activity',
      }),
      expect.objectContaining({
        type: 'line',
        data: [0, 4000],
        yAxisID: 'balance',
        pointStyle: 'rectRot',
        fill: false,
      }),
      expect.objectContaining({
        type: 'line',
        data: [4000, 4800],
        yAxisID: 'balance',
        pointStyle: 'circle',
        fill: false,
      }),
    ]);
    expect(configuration.options).toMatchObject({
      animation: false,
      maintainAspectRatio: false,
      responsive: true,
      scales: {
        activity: {type: 'linear', position: 'left', beginAtZero: true},
        balance: {
          type: 'linear',
          position: 'right',
          grid: {drawOnChartArea: false},
        },
      },
    });
    expect(
      configuration.options.plugins.tooltip.callbacks.label({
        dataset: {label: '實際期末結餘'},
        parsed: {y: 4800},
      }),
    ).toBe('實際期末結餘：NT$4,800');
  });

  it('renders the filtered and actual values in a semantic table', async () => {
    const user = userEvent.setup();
    render(<SemesterComparisonChart semesters={semesters} />);

    await user.click(screen.getByRole('button', {name: '查看資料表'}));
    const table = screen.getByRole('table', {name: '各學期收支比較資料'});
    expect(table).toBeVisible();
    for (const heading of [
      '學期',
      '篩選收入',
      '篩選支出',
      '實際期初結餘',
      '實際期末結餘',
    ]) {
      expect(
        within(table).getByRole('columnheader', {name: heading}),
      ).toBeVisible();
    }
    expect(
      within(table).getByRole('row', {
        name: '第二學期 NT$800 NT$0 NT$4,000 NT$4,800',
      }),
    ).toBeVisible();
  });

  it('destroys stale charts on semester changes and on unmount', () => {
    const {rerender, unmount} = render(
      <SemesterComparisonChart semesters={semesters} />,
    );
    const first = chartMocks.instances[0]!;

    rerender(<SemesterComparisonChart semesters={semesters.slice(0, 1)} />);
    expect(first.destroy).toHaveBeenCalledOnce();
    const second = chartMocks.instances[1]!;

    unmount();
    expect(second.destroy).toHaveBeenCalledOnce();
  });

  it('keeps the data table usable when chart initialization fails', async () => {
    const user = userEvent.setup();
    chartMocks.failNext = true;
    render(<SemesterComparisonChart semesters={semesters} />);

    expect(
      document.querySelector('canvas[aria-label="各學期收支比較圖"]'),
    ).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('圖表無法顯示，請查看資料表')).toHaveAttribute(
      'role',
      'status',
    );
    await user.click(screen.getByRole('button', {name: '查看資料表'}));
    expect(
      screen.getByRole('table', {name: '各學期收支比較資料'}),
    ).toBeVisible();
  });

  it('renders an empty state without constructing a chart', () => {
    render(<SemesterComparisonChart semesters={[]} />);

    expect(screen.getByText('目前沒有學期資料')).toBeVisible();
    expect(Chart).not.toHaveBeenCalled();
  });
});
