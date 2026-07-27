import {resolve} from 'node:path';

import react from '@vitejs/plugin-react';
import {describe, expect, it} from 'vitest';
import {build} from 'vite';

describe('report client dependency boundary', () => {
  it('excludes ledger validation and Buffer compatibility code', async () => {
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [react()],
      build: {
        minify: false,
        write: false,
        rollupOptions: {
          input: resolve('src/components/ReportApp.tsx'),
          preserveEntrySignatures: 'strict',
        },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const clientCode = outputs
      .flatMap((output) => {
        if (!('output' in output)) {
          throw new Error('Expected a completed client build');
        }
        return output.output.flatMap((artifact) =>
          artifact.type === 'chunk' ? [artifact.code] : [],
        );
      })
      .join('\n');

    expect(clientCode).not.toContain('ZodError');
    expect(clientCode).not.toContain('Buffer size must be');
    expect(clientCode).not.toContain('CSV header must match canonical order');
    expect(clientCode).not.toContain('node:fs');
    expect(clientCode).not.toContain('node:path');
    for (const chartName of [
      '總餘額走勢圖',
      '分類支出比例圖',
      '分類收入比例圖',
      '各學期收支比較圖',
    ]) {
      expect(clientCode).toContain(chartName);
    }
  });
});
