import type {ReactElement} from 'react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {AppProps} from '../src/app.js';

const mocks = vi.hoisted(() => ({
  findLedgerRoot: vi.fn(),
  hasSetupMarker: vi.fn(),
  inspectLedgerRoot: vi.fn(),
  open: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
  writeSetupMarker: vi.fn(),
}));

vi.mock('../src/find-root.js', () => ({
  findLedgerRoot: mocks.findLedgerRoot,
}));

vi.mock('../src/setup-marker.js', () => ({
  hasSetupMarker: mocks.hasSetupMarker,
  writeSetupMarker: mocks.writeSetupMarker,
}));

vi.mock('@class-fund/ledger/node', () => ({
  inspectLedgerRoot: mocks.inspectLedgerRoot,
  LedgerRepository: {open: mocks.open},
}));

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return {...actual, render: mocks.render};
});

const originalInitCwd = process.env.INIT_CWD;
const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetModules();
  process.exitCode = undefined;
  mocks.findLedgerRoot.mockReturnValue('/ledger');
  mocks.hasSetupMarker.mockResolvedValue(true);
  mocks.inspectLedgerRoot.mockResolvedValue({
    root: '/ledger',
    settingsText: '{}',
    transactionsText: '',
    issues: [],
    state: {settings: {}, transactions: []},
  });
  mocks.open.mockResolvedValue({getState: vi.fn()});
  mocks.render.mockReturnValue({unmount: mocks.unmount});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (originalInitCwd === undefined) {
    delete process.env.INIT_CWD;
  } else {
    process.env.INIT_CWD = originalInitCwd;
  }
  process.exitCode = originalExitCode;
});

describe('TUI entry point', () => {
  it('discovers from INIT_CWD, opens a valid repository, and unmounts on exit', async () => {
    process.env.INIT_CWD = '/invocation/path';

    await import('../src/main.js');

    expect(mocks.findLedgerRoot).toHaveBeenCalledWith('/invocation/path');
    expect(mocks.inspectLedgerRoot).toHaveBeenCalledWith('/ledger');
    expect(mocks.hasSetupMarker).toHaveBeenCalledWith('/ledger');
    expect(mocks.open).toHaveBeenCalledWith('/ledger');
    const tree = mocks.render.mock.calls[0]?.[0] as ReactElement<AppProps>;
    expect(tree.props).toMatchObject({
      root: '/ledger',
      repository: await mocks.open.mock.results[0]!.value,
      setupComplete: true,
    });

    tree.props.onExit();
    expect(mocks.unmount).toHaveBeenCalledOnce();
  });

  it('uses process.cwd and renders inspection recovery without opening invalid data', async () => {
    delete process.env.INIT_CWD;
    vi.spyOn(process, 'cwd').mockReturnValue('/working/path');
    const inspection = {
      root: '/ledger',
      settingsText: '{broken',
      transactionsText: null,
      issues: [{source: 'settings', field: 'json', message: 'Malformed JSON'}],
      state: null,
    };
    mocks.inspectLedgerRoot.mockResolvedValue(inspection);
    mocks.hasSetupMarker.mockResolvedValue(false);

    await import('../src/main.js');

    expect(mocks.findLedgerRoot).toHaveBeenCalledWith('/working/path');
    expect(mocks.open).not.toHaveBeenCalled();
    const tree = mocks.render.mock.calls[0]?.[0] as ReactElement<AppProps>;
    expect(tree.props).toMatchObject({
      root: '/ledger',
      inspection,
      setupComplete: false,
    });
  });

  it('contains root-discovery failures without exposing raw error details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    mocks.findLedgerRoot.mockImplementationOnce(() => {
      throw new Error('sensitive root failure at /private/ledger');
    });

    await expect(import('../src/main.js')).resolves.toBeDefined();

    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      '無法啟動班費帳本，請確認資料路徑與檔案權限。',
    );
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
      'sensitive root failure',
    );
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
      '/private/ledger',
    );
    expect(process.exitCode).toBe(1);
    expect(exit).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('contains setup-marker permission failures without exposing raw error details', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    mocks.hasSetupMarker.mockRejectedValueOnce(
      new Error('EACCES while reading /private/ledger/.local'),
    );

    await expect(import('../src/main.js')).resolves.toBeDefined();

    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      '無法啟動班費帳本，請確認資料路徑與檔案權限。',
    );
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('EACCES');
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain(
      '/private/ledger',
    );
    expect(process.exitCode).toBe(1);
    expect(exit).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });
});
