import {render, screen, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const chartMocks = vi.hoisted(() => ({
  instances: [] as Array<{destroy: ReturnType<typeof vi.fn>}>,
  register: vi.fn(),
}));

vi.mock('chart.js', () => {
  const Chart = vi.fn(function () {
    const instance = {destroy: vi.fn()};
    chartMocks.instances.push(instance);
    return instance;
  });

  Object.assign(Chart, {register: chartMocks.register});

  return {
    BarController: 'BarController',
    BarElement: 'BarElement',
    CategoryScale: 'CategoryScale',
    Chart,
    LinearScale: 'LinearScale',
    Tooltip: 'Tooltip',
  };
});

import {Chart} from 'chart.js';

import {ExpenseChart} from '../src/components/ExpenseChart.js';

describe('ExpenseChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chartMocks.instances.length = 0;
  });

  it('renders an accessible chart and matching text fallback', () => {
    render(<ExpenseChart values={{'清潔用品': 700, '教材與影印': 300}} />);

    expect(Chart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'bar',
        data: expect.objectContaining({
          labels: ['清潔用品', '教材與影印'],
        }),
      }),
    );
    expect(
      document.querySelector('canvas[aria-label="依分類統計支出"]'),
    ).toBeVisible();
    const fallback = screen.getByRole('list', {name: '各分類支出金額'});
    expect(within(fallback).getByText('清潔用品')).toBeVisible();
    expect(within(fallback).getByText('NT$700')).toBeVisible();
    expect(within(fallback).getByText('教材與影印')).toBeVisible();
    expect(within(fallback).getByText('NT$300')).toBeVisible();
  });

  it('destroys stale chart instances on data changes and unmount', () => {
    const {rerender, unmount} = render(
      <ExpenseChart values={{'清潔用品': 700, '教材與影印': 300}} />,
    );
    const first = chartMocks.instances[0]!;

    rerender(<ExpenseChart values={{'教材與影印': 300}} />);
    expect(first.destroy).toHaveBeenCalledOnce();
    const second = chartMocks.instances[1]!;

    unmount();
    expect(second.destroy).toHaveBeenCalledOnce();
  });
});
