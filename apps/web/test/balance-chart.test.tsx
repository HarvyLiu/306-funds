import type {BalancePoint} from '@class-fund/ledger/analytics';
import {act, render, screen, within} from '@testing-library/react';
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

import {BalanceChart} from '../src/components/BalanceChart.js';

const balancePoints: BalancePoint[] = [
  {
    kind: 'opening',
    transactionId: null,
    date: null,
    subject: '期初結餘',
    signedAmount: null,
    balance: 4000,
    matchesFilter: true,
  },
  {
    kind: 'transaction',
    transactionId: 'spring-income',
    date: '2027-02-01',
    subject: '補收班費',
    signedAmount: 800,
    balance: 4800,
    matchesFilter: false,
  },
];

interface BalanceConfiguration {
  type: string;
  data: {
    labels: string[];
    datasets: Array<{
      label: string;
      data: number[];
      pointRadius: number[];
      pointHoverRadius: number[];
      pointStyle: string[];
    }>;
  };
  options: {
    animation: boolean;
    responsive: boolean;
    maintainAspectRatio: boolean;
    plugins: {
      tooltip: {
        callbacks: {
          title: (items: Array<{dataIndex: number}>) => string;
          label: (item: {dataIndex: number}) => string;
          afterLabel: (item: {dataIndex: number}) => string;
        };
        external: (context: {
          tooltip: {
            opacity: number;
            dataPoints: Array<{dataIndex: number}>;
          };
        }) => void;
      };
    };
  };
}

function capturedConfiguration(): BalanceConfiguration {
  return chartMocks.configurations.at(-1) as BalanceConfiguration;
}

describe('BalanceChart', () => {
  beforeEach(() => {
    vi.mocked(Chart).mockClear();
    chartMocks.configurations.length = 0;
    chartMocks.instances.length = 0;
    chartMocks.failNext = false;
  });

  it('renders the true balance line with emphasized matching points', () => {
    render(<BalanceChart points={balancePoints} />);

    expect(Chart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'line',
        data: expect.objectContaining({
          labels: ['期初結餘', '2027-02-01 補收班費'],
        }),
      }),
    );
    const canvas = screen.getByRole('img', {name: '總餘額走勢圖'});
    expect(canvas).toBeVisible();
    expect(canvas).not.toHaveAttribute('aria-hidden');
    expect(canvas.parentElement).toHaveClass('chart-stage-balance');

    const configuration = capturedConfiguration();
    expect(configuration.options).toMatchObject({
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
    });
    expect(configuration.data.datasets[0]).toMatchObject({
      label: '實際總餘額',
      data: [4000, 4800],
      pointRadius: [5, 2],
      pointHoverRadius: [7, 4],
      pointStyle: ['rectRot', 'circle'],
    });
  });

  it('exposes exact tooltip details and an equivalent semantic table', async () => {
    const user = userEvent.setup();
    render(<BalanceChart points={balancePoints} />);

    const callbacks = capturedConfiguration().options.plugins.tooltip.callbacks;
    expect(callbacks.title([{dataIndex: 1}])).toBe(
      '2027-02-01 補收班費',
    );
    expect(callbacks.label({dataIndex: 1})).toBe('+NT$800');
    expect(callbacks.afterLabel({dataIndex: 1})).toBe('餘額 NT$4,800');
    expect(callbacks.label({dataIndex: 0})).toBe('期初結餘');

    await user.click(screen.getByRole('button', {name: '查看資料表'}));
    const table = screen.getByRole('table', {name: '總餘額走勢資料'});
    expect(table).toBeVisible();
    for (const heading of ['日期', '項目', '變動', '結果餘額', '篩選狀態']) {
      expect(
        within(table).getByRole('columnheader', {name: heading}),
      ).toBeVisible();
    }
    expect(within(table).getByText('不符合目前次要篩選')).toBeVisible();
  });

  it('updates and clears the live balance detail through the external tooltip', () => {
    render(<BalanceChart points={balancePoints} />);
    const external = capturedConfiguration().options.plugins.tooltip.external;

    act(() => {
      external({tooltip: {opacity: 1, dataPoints: [{dataIndex: 1}]}});
    });
    expect(
      screen.getByText('2027-02-01 補收班費 +NT$800，餘額 NT$4,800'),
    ).toBeVisible();

    act(() => {
      external({tooltip: {opacity: 0, dataPoints: []}});
    });
    expect(
      screen.queryByText('2027-02-01 補收班費 +NT$800，餘額 NT$4,800'),
    ).not.toBeInTheDocument();
  });

  it('destroys stale charts on point changes and on unmount', () => {
    const {rerender, unmount} = render(
      <BalanceChart points={balancePoints} />,
    );
    const first = chartMocks.instances[0]!;

    rerender(<BalanceChart points={balancePoints.slice(0, 1)} />);
    expect(first.destroy).toHaveBeenCalledOnce();
    const second = chartMocks.instances[1]!;

    unmount();
    expect(second.destroy).toHaveBeenCalledOnce();
  });

  it('keeps the data table usable when chart initialization fails', async () => {
    const user = userEvent.setup();
    chartMocks.failNext = true;
    render(<BalanceChart points={balancePoints} />);

    expect(
      document.querySelector('canvas[aria-label="總餘額走勢圖"]'),
    ).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('圖表無法顯示，請查看資料表')).toHaveAttribute(
      'role',
      'status',
    );
    await user.click(screen.getByRole('button', {name: '查看資料表'}));
    expect(
      screen.getByRole('table', {name: '總餘額走勢資料'}),
    ).toBeVisible();
  });

  it('renders an empty state without constructing a chart', () => {
    render(<BalanceChart points={[]} />);

    expect(screen.getByText('目前沒有餘額資料')).toBeVisible();
    expect(Chart).not.toHaveBeenCalled();
  });
});
