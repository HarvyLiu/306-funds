import {Chart, type ChartConfiguration, type ChartType} from 'chart.js';
import {useEffect, useRef} from 'react';

// Callers must memoize both configuration and onError to avoid recreating charts.
export function useChart<TType extends ChartType>(
  configuration: ChartConfiguration<TType>,
  onError: () => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return;
    }

    let chart: Chart<TType> | undefined;
    try {
      chart = new Chart(canvas, configuration);
    } catch {
      onError();
    }

    return () => chart?.destroy();
  }, [configuration, onError]);

  return canvasRef;
}
