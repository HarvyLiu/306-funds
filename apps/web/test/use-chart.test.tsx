import type {ChartConfiguration} from 'chart.js';
import {render} from '@testing-library/react';
import {StrictMode, useCallback, useMemo} from 'react';
import {beforeEach, describe, expect, it, vi} from 'vitest';

interface ChartInstance {
  destroy: ReturnType<typeof vi.fn>;
}

const chartMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  instances: [] as ChartInstance[],
}));

vi.mock('chart.js', () => ({
  Chart: vi.fn(function (
    canvas: HTMLCanvasElement,
    configuration: ChartConfiguration,
  ) {
    const instance = chartMocks.construct(canvas, configuration) as ChartInstance;
    chartMocks.instances.push(instance);
    return instance;
  }),
}));

import {useChart} from '../src/components/use-chart.js';

interface ChartHarnessProps {
  version: number;
  onError: () => void;
}

function ChartHarness({version, onError}: ChartHarnessProps) {
  const configuration = useMemo<ChartConfiguration<'line'>>(
    () => ({
      type: 'line',
      data: {
        labels: [`version-${version}`],
        datasets: [{data: [version]}],
      },
    }),
    [version],
  );
  const handleError = useCallback(() => onError(), [onError]);
  const canvasRef = useChart(configuration, handleError);

  return <canvas ref={canvasRef} />;
}

describe('useChart', () => {
  beforeEach(() => {
    chartMocks.instances.length = 0;
    chartMocks.construct.mockReset();
    chartMocks.construct.mockImplementation(() => ({destroy: vi.fn()}));
  });

  it('destroys stale charts after configuration changes and on unmount', () => {
    const onError = vi.fn();
    const {rerender, unmount} = render(
      <ChartHarness version={1} onError={onError} />,
    );
    const first = chartMocks.instances[0]!;

    rerender(<ChartHarness version={2} onError={onError} />);

    expect(first.destroy).toHaveBeenCalledOnce();
    const second = chartMocks.instances[1]!;

    unmount();

    expect(second.destroy).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('destroys every chart constructed during StrictMode effect replay', () => {
    const onError = vi.fn();
    const {unmount} = render(
      <StrictMode>
        <ChartHarness version={1} onError={onError} />
      </StrictMode>,
    );

    expect(chartMocks.instances).toHaveLength(2);

    unmount();

    for (const instance of chartMocks.instances) {
      expect(instance.destroy).toHaveBeenCalledOnce();
    }
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports chart initialization failure without leaking the error', () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    chartMocks.construct.mockImplementationOnce(() => {
      throw new Error('canvas unavailable');
    });

    const {container} = render(
      <ChartHarness version={3} onError={onError} />,
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(container).not.toHaveTextContent('canvas unavailable');
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
