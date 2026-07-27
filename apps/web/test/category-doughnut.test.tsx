import type {CategorySlice} from '@class-fund/ledger/analytics';
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

import {CategoryDoughnut} from '../src/components/CategoryDoughnut.js';
import {categoryColors} from '../src/components/chart-palette.js';

const slices: CategorySlice[] = [
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
];

interface DoughnutConfiguration {
  type: string;
  data: {
    labels: string[];
    datasets: Array<{data: number[]; backgroundColor: string[]}>;
  };
  options: {
    animation: boolean;
    cutout: string;
    maintainAspectRatio: boolean;
    responsive: boolean;
    plugins: {
      legend: {
        position: string;
        labels: {boxWidth: number; boxHeight: number};
      };
      tooltip: {
        callbacks: {
          label: (item: {dataIndex: number}) => string;
        };
      };
    };
  };
}

function capturedConfiguration(): DoughnutConfiguration {
  return chartMocks.configurations.at(-1) as DoughnutConfiguration;
}

describe('CategoryDoughnut', () => {
  beforeEach(() => {
    vi.mocked(Chart).mockClear();
    chartMocks.configurations.length = 0;
    chartMocks.instances.length = 0;
    chartMocks.failNext = false;
  });

  it.each([
    {
      kind: 'income' as const,
      canvasLabel: '分類收入比例圖',
      tableLabel: '分類收入比例資料',
    },
    {
      kind: 'expense' as const,
      canvasLabel: '分類支出比例圖',
      tableLabel: '分類支出比例資料',
    },
  ])(
    'renders $kind labels, amounts, palette, tooltip, and grouped table data',
    async ({kind, canvasLabel, tableLabel}) => {
      const user = userEvent.setup();
      render(<CategoryDoughnut kind={kind} slices={slices} />);

      const canvas = screen.getByRole('img', {name: canvasLabel});
      expect(canvas).toBeVisible();
      expect(canvas).not.toHaveAttribute('aria-hidden');
      expect(canvas.parentElement).toHaveClass('chart-stage-doughnut');
      const configuration = capturedConfiguration();
      expect(configuration).toMatchObject({
        type: 'doughnut',
        data: {
          labels: ['其他', '其他（彙整）'],
          datasets: [
            {
              data: [600, 400],
              backgroundColor: [categoryColors[0], categoryColors[1]],
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
          },
        },
      });
      expect(
        configuration.options.plugins.tooltip.callbacks.label({dataIndex: 1}),
      ).toBe('其他（彙整）：NT$400，40%，3 筆');

      await user.click(screen.getByRole('button', {name: '查看資料表'}));
      const table = screen.getByRole('table', {name: tableLabel});
      expect(table).toBeVisible();
      for (const heading of [
        '分類',
        '金額',
        '百分比',
        '筆數',
        '包含分類',
      ]) {
        expect(
          within(table).getByRole('columnheader', {name: heading}),
        ).toBeVisible();
      }
      expect(
        within(table).getByRole('row', {
          name: /其他（彙整） NT\$400 40% 3 筆 教材與影印、清潔用品/,
        }),
      ).toBeVisible();
      expect(
        within(table).getByRole('row', {name: /^其他 NT\$600 60% 2 筆 其他$/}),
      ).toBeVisible();
    },
  );

  it.each([
    ['income', '目前沒有收入資料'],
    ['expense', '目前沒有支出資料'],
  ] as const)('renders the %s empty state without a chart', (kind, message) => {
    render(<CategoryDoughnut kind={kind} slices={[]} />);

    expect(screen.getByText(message)).toBeVisible();
    expect(Chart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', {name: '查看資料表'})).toBeVisible();
  });

  it('destroys stale charts on slice changes and on unmount', () => {
    const {rerender, unmount} = render(
      <CategoryDoughnut kind="expense" slices={slices} />,
    );
    const first = chartMocks.instances[0]!;

    rerender(<CategoryDoughnut kind="expense" slices={slices.slice(0, 1)} />);
    expect(first.destroy).toHaveBeenCalledOnce();
    const second = chartMocks.instances[1]!;

    unmount();
    expect(second.destroy).toHaveBeenCalledOnce();
  });

  it('keeps the data table usable when chart initialization fails', async () => {
    const user = userEvent.setup();
    chartMocks.failNext = true;
    render(<CategoryDoughnut kind="expense" slices={slices} />);

    expect(
      document.querySelector('canvas[aria-label="分類支出比例圖"]'),
    ).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('圖表無法顯示，請查看資料表')).toHaveAttribute(
      'role',
      'status',
    );
    await user.click(screen.getByRole('button', {name: '查看資料表'}));
    expect(
      screen.getByRole('table', {name: '分類支出比例資料'}),
    ).toBeVisible();
  });

  it('registers the shared Chart.js primitives once', () => {
    expect(chartMocks.register).toHaveBeenCalledOnce();
    expect(chartMocks.register).toHaveBeenCalledWith(
      'ArcElement',
      'BarController',
      'BarElement',
      'CategoryScale',
      'DoughnutController',
      'Legend',
      'LineController',
      'LineElement',
      'LinearScale',
      'PointElement',
      'Tooltip',
    );
  });
});
