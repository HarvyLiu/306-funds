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
  });
});
