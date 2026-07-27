import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

import config from '../playwright.config.js';

describe('Playwright server contract', () => {
  it('always starts the fixture report on a strict local port', () => {
    expect(Array.isArray(config.webServer)).toBe(false);
    const webServer = Array.isArray(config.webServer)
      ? undefined
      : config.webServer;

    expect(webServer).toMatchObject({
      command:
        'LEDGER_ROOT=./test/fixtures/repo npm run build && npm run preview -- --host 127.0.0.1 --strictPort',
      url: 'http://127.0.0.1:4321',
      reuseExistingServer: false,
    });
    expect(config.use?.baseURL).toBe('http://127.0.0.1:4321');
  });

  it('keeps the static report configurable for a GitHub Pages base path', () => {
    const astroConfig = readFileSync(resolve('astro.config.mjs'), 'utf8');

    expect(astroConfig).toMatch(/site:\s*process\.env\.SITE_URL/);
    expect(astroConfig).toMatch(
      /base:\s*process\.env\.BASE_PATH\s*\?\?\s*["']\/["']/,
    );
  });
});
