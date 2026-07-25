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
  });
});
