import {
  LedgerValidationError,
  parseTransactionsCsv,
  type LedgerSettings,
  type LedgerState,
  type Transaction,
} from '@class-fund/ledger';
import {
  MissingBackupError,
  type BackupInspection,
  type LedgerInspection,
  type LedgerRepository,
} from '@class-fund/ledger/node';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {App} from '../src/app.js';

const mocks = vi.hoisted(() => ({
  inspectLedgerRoot: vi.fn(),
  inspectLedgerBackup: vi.fn(),
  restoreLedgerBackup: vi.fn(),
  open: vi.fn(),
}));

vi.mock('@class-fund/ledger/node', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@class-fund/ledger/node')>();
  return {
    ...actual,
    inspectLedgerRoot: mocks.inspectLedgerRoot,
    inspectLedgerBackup: mocks.inspectLedgerBackup,
    restoreLedgerBackup: mocks.restoreLedgerBackup,
    LedgerRepository: {...actual.LedgerRepository, open: mocks.open},
  };
});

const settings: LedgerSettings = {
  schema_version: 1,
  currency: 'TWD',
  active_semester: '第一學期',
  default_officer: '我',
  semesters: [{value: '第一學期', status: 'active'}],
  categories: [{value: '期初餘額', status: 'active'}],
  officers: [{value: '我', status: 'active'}],
};

const transaction: Transaction = {
  id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670010',
  date: '2026-08-01',
  semester: '第一學期',
  subject: '期初班費',
  category: '期初餘額',
  type: 'income',
  amount: 5000,
  handled_by: '我',
  note: '',
  created_at: '2026-08-01T08:00:00+08:00',
};

function parserValidationIssues() {
  const csv = [
    'id,date,semester,subject,category,type,amount,handled_by,note,created_at',
    '018f7f2c-98c0-7d5a-a4df-1bcd4a670001,2026-08-01,第一學期,期初班費,期初餘額,income,5000,我,,2026-08-01T08:00:00+08:00',
    'NOT-A-LOWERCASE-UUID,2026-08-01,第一學期,期初班費,期初餘額,income,0,我,,2026-08-01T08:00:00+08:00',
  ].join('\n');

  try {
    parseTransactionsCsv(csv, settings);
  } catch (error) {
    if (error instanceof LedgerValidationError) return [...error.issues];
    throw error;
  }
  throw new Error('Expected the parser fixture to fail validation');
}

const invalidInspection: LedgerInspection = {
  root: '/ledger',
  settingsText: '{}',
  transactionsText: 'broken',
  state: null,
  issues: [
    ...parserValidationIssues(),
    {
      source: 'settings',
      field: 'json',
      value: '{broken',
      message: 'Malformed JSON',
    },
    {
      source: 'settings',
      field: 'future_rule',
      value: 'future rejected value',
      message: 'Future English validation message',
    },
  ],
};

const validInspection: LedgerInspection = {
  root: '/ledger',
  settingsText: '{}',
  transactionsText: '',
  state: {settings, transactions: [transaction]},
  issues: [],
};

const backup: BackupInspection = {
  kind: 'transactions',
  transactions: 1,
  totals: {income: 5000, expenses: 0, net: 5000},
  state: {settings, transactions: [transaction]},
};

async function nextRender(): Promise<void> {
  await new Promise<void>((done) => setImmediate(done));
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

function writeInputOnNextFrame(
  stdout: ReturnType<typeof render>['stdout'],
  stdin: ReturnType<typeof render>['stdin'],
  frameText: string,
  input: string,
): void {
  const write = stdout.write;
  let sent = false;
  stdout.write = (frame) => {
    write(frame);
    if (!sent && frame.includes(frameText)) {
      sent = true;
      stdin.write(input);
    }
  };
}

beforeEach(() => {
  mocks.inspectLedgerRoot.mockResolvedValue(invalidInspection);
  mocks.inspectLedgerBackup.mockResolvedValue(backup);
  mocks.restoreLedgerBackup.mockResolvedValue(validInspection);
  mocks.open.mockResolvedValue({
    getState: vi.fn(() => structuredClone(validInspection.state)),
    reload: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('recovery mode', () => {
  it('accepts the first backup selection immediately after opening the selector', async () => {
    const {stdin, stdout} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    writeInputOnNextFrame(stdout, stdin, '選擇備份', '1');
    stdin.write('r');

    await vi.waitFor(() =>
      expect(mocks.inspectLedgerBackup).toHaveBeenCalledWith(
        '/ledger',
        'transactions',
      ),
    );
  });

  it('accepts y immediately when a backup preview appears', async () => {
    const {stdin, stdout} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    writeInputOnNextFrame(stdout, stdin, '備份預覽', 'y');
    stdin.write('1');

    await vi.waitFor(() =>
      expect(mocks.restoreLedgerBackup).toHaveBeenCalledWith(
        '/ledger',
        'transactions',
      ),
    );
  });

  it('accepts an immediate retry after restore failure', async () => {
    mocks.restoreLedgerBackup.mockRejectedValueOnce(
      new LedgerValidationError([
        {
          source: 'transactions',
          field: 'file',
          message: 'Ledger file is missing',
        },
      ]),
    );
    const {lastFrame, stdin, stdout} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    writeInputOnNextFrame(stdout, stdin, '找不到帳本檔案', 'r');
    stdin.write('y');

    await vi.waitFor(() => expect(lastFrame()).toContain('選擇備份'));
  });

  it('accepts an immediate retry when reload returns to recovery', async () => {
    const pendingReload = deferred<LedgerInspection>();
    mocks.inspectLedgerRoot.mockReturnValueOnce(pendingReload.promise);
    const {lastFrame, stdin, stdout} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('l');
    await vi.waitFor(() => expect(lastFrame()).toContain('正在重新載入'));
    writeInputOnNextFrame(
      stdout,
      stdin,
      'l 重新載入  r 還原備份',
      'l',
    );
    pendingReload.resolve(invalidInspection);

    await vi.waitFor(() =>
      expect(mocks.inspectLedgerRoot).toHaveBeenCalledTimes(2),
    );
  });

  it('keeps startup backup inspection authoritative over same-tick Escape', async () => {
    const pendingInspection = deferred<BackupInspection>();
    mocks.inspectLedgerBackup.mockReturnValueOnce(pendingInspection.promise);
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    stdin.write('\u001b[27u');
    stdin.write('a');
    await vi.waitFor(() =>
      expect(mocks.inspectLedgerBackup).toHaveBeenCalledOnce(),
    );
    expect(lastFrame()).toContain('正在檢查備份');
    expect(lastFrame()).not.toContain('新增交易');
    expect(lastFrame()).not.toContain('復原模式');

    pendingInspection.resolve(backup);
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
  });

  it('keeps startup restore pending after same-tick y and Escape', async () => {
    const pendingRestore = deferred<LedgerInspection>();
    const pendingReopen = deferred<LedgerRepository>();
    mocks.restoreLedgerBackup.mockReturnValueOnce(pendingRestore.promise);
    mocks.open.mockReturnValueOnce(pendingReopen.promise);
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    stdin.write('y');
    stdin.write('\u001b[27u');
    stdin.write('a');
    await vi.waitFor(() =>
      expect(mocks.restoreLedgerBackup).toHaveBeenCalledOnce(),
    );
    expect(lastFrame()).toContain('正在還原備份');
    expect(lastFrame()).not.toContain('新增交易');
    expect(lastFrame()).not.toContain('復原模式');

    pendingRestore.resolve(validInspection);
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledWith('/ledger'));
    expect(lastFrame()).toContain('正在還原備份');
    pendingReopen.resolve({
      getState: vi.fn(() => structuredClone(validInspection.state)),
    } as unknown as LedgerRepository);
    await vi.waitFor(() => expect(lastFrame()).toContain('目前總餘額  NT$5,000'));
  });

  it('single-flights startup backup inspection and ignores conflicting input until completion', async () => {
    const pendingInspection = deferred<BackupInspection>();
    mocks.inspectLedgerBackup.mockReturnValueOnce(pendingInspection.promise);
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() =>
      expect(mocks.inspectLedgerBackup).toHaveBeenCalledWith(
        '/ledger',
        'transactions',
      ),
    );
    expect(lastFrame()).toContain('正在檢查備份');

    stdin.write('2');
    stdin.write('\u001b[27u');
    stdin.write('r');
    stdin.write('l');
    stdin.write('a');
    await nextRender();
    expect(lastFrame()).toContain('正在檢查備份');
    expect(mocks.inspectLedgerBackup).toHaveBeenCalledOnce();
    expect(mocks.inspectLedgerRoot).not.toHaveBeenCalled();
    expect(mocks.restoreLedgerBackup).not.toHaveBeenCalled();

    pendingInspection.resolve(backup);
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    expect(lastFrame()).toContain('交易備份');
    stdin.write('\u001b[27u');
    await nextRender();
    expect(lastFrame()).toContain('復原模式');
    expect(lastFrame()).not.toContain('備份預覽');
  });

  it('single-flights startup reload before allowing a restore flow', async () => {
    const pendingReload = deferred<LedgerInspection>();
    mocks.inspectLedgerRoot.mockReturnValueOnce(pendingReload.promise);
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('l');
    await vi.waitFor(() => expect(mocks.inspectLedgerRoot).toHaveBeenCalledOnce());
    expect(lastFrame()).toContain('正在重新載入');
    stdin.write('r');
    stdin.write('l');
    stdin.write('\u001b[27u');
    await nextRender();
    expect(lastFrame()).toContain('正在重新載入');
    expect(lastFrame()).not.toContain('選擇備份');
    expect(mocks.inspectLedgerRoot).toHaveBeenCalledOnce();
    expect(mocks.inspectLedgerBackup).not.toHaveBeenCalled();

    pendingReload.resolve(invalidInspection);
    await vi.waitFor(() =>
      expect(lastFrame()).not.toContain('正在重新載入'),
    );
    expect(lastFrame()).toContain('復原模式');
    stdin.write('r');
    await nextRender();
    expect(lastFrame()).toContain('選擇備份');
  });

  it('shows typed issue metadata, reloads, previews restore, cancels, then restores', async () => {
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('交易 / 第 3 列 / amount');
    expect(lastFrame()).toContain('ID 必須是小寫 UUID');
    expect(lastFrame()).toContain('金額必須是正整數');
    expect(lastFrame()).toContain('JSON 格式錯誤');
    expect(lastFrame()).toContain('資料內容不符合規則');
    expect(lastFrame()).toContain('NOT-A-LOWERCASE-UUID');
    expect(lastFrame()).toContain('拒絕值：0');
    expect(lastFrame()).toContain('{broken');
    expect(lastFrame()).toContain('future rejected value');
    expect(lastFrame()).not.toContain('ID must be a lowercase UUID');
    expect(lastFrame()).not.toContain('Amount must be a positive whole number');
    expect(lastFrame()).not.toContain('Malformed JSON');
    expect(lastFrame()).not.toContain('Future English validation message');

    stdin.write('l');
    await vi.waitFor(() => expect(mocks.inspectLedgerRoot).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(lastFrame()).toContain('l 重新載入  r 還原備份'),
    );
    expect(lastFrame()).toContain('復原模式');

    stdin.write('r');
    await nextRender();
    expect(lastFrame()).toContain('選擇備份');
    stdin.write('1');
    await vi.waitFor(() => expect(mocks.inspectLedgerBackup).toHaveBeenCalledWith('/ledger', 'transactions'));
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    expect(lastFrame()).toContain('交易筆數 1');
    expect(lastFrame()).toContain('總收入 NT$5,000');

    stdin.write('\u001b[27u');
    await nextRender();
    expect(lastFrame()).toContain('復原模式');
    expect(mocks.restoreLedgerBackup).not.toHaveBeenCalled();

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    stdin.write('y');
    await vi.waitFor(() => expect(mocks.restoreLedgerBackup).toHaveBeenCalledWith('/ledger', 'transactions'));
    await vi.waitFor(() => expect(lastFrame()).toContain('目前總餘額  NT$5,000'));
    expect(mocks.open).toHaveBeenCalledWith('/ledger');
  });

  it.each([
    {
      failure: new MissingBackupError('/ledger/.local/backups/transactions.csv'),
      message: '找不到交易備份',
    },
    {
      failure: new LedgerValidationError([
        {
          source: 'transactions',
          row: 2,
          field: 'amount',
          value: '0',
          message: 'Amount must be a positive whole number',
        },
      ]),
      message: '金額必須是正整數',
    },
  ])('keeps recovery active when backup inspection fails', async ({failure, message}) => {
    mocks.inspectLedgerBackup.mockRejectedValueOnce(failure);
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toContain(message));
    expect(lastFrame()).toContain('復原模式');
    expect(mocks.restoreLedgerBackup).not.toHaveBeenCalled();

    stdin.write('l');
    await vi.waitFor(() => expect(mocks.inspectLedgerRoot).toHaveBeenCalledOnce());
  });

  it('allows a fresh preview and retry after a restore attempt fails', async () => {
    mocks.restoreLedgerBackup
      .mockRejectedValueOnce(
        new LedgerValidationError([
          {
            source: 'transactions',
            field: 'file',
            message: 'Ledger file is missing',
          },
        ]),
      )
      .mockResolvedValueOnce(validInspection);
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    stdin.write('y');
    await vi.waitFor(() => expect(lastFrame()).toContain('找不到帳本檔案'));

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    stdin.write('y');
    await vi.waitFor(() => expect(mocks.restoreLedgerBackup).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(lastFrame()).toContain('目前總餘額  NT$5,000'));
  });

  it('does not continue reopening after unmount during a pending restore', async () => {
    const pendingRestore = deferred<LedgerInspection>();
    mocks.restoreLedgerBackup.mockReturnValueOnce(pendingRestore.promise);
    const {lastFrame, stdin, unmount} = render(
      <App
        root="/ledger"
        inspection={invalidInspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    stdin.write('y');
    await vi.waitFor(() => expect(mocks.restoreLedgerBackup).toHaveBeenCalledOnce());

    unmount();
    pendingRestore.resolve(validInspection);
    await nextRender();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});

describe('overview backup restore', () => {
  it('keeps ready backup inspection authoritative over same-tick Escape and add', async () => {
    const pendingInspection = deferred<BackupInspection>();
    const repository = {
      getState: vi.fn(() => ({settings, transactions: [transaction]})),
      inspectBackup: vi.fn(() => pendingInspection.promise),
      restore: vi.fn(),
      reload: vi.fn(),
      saveSettings: vi.fn(),
      saveTransactions: vi.fn(),
    } as unknown as LedgerRepository;
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    stdin.write('\u001b[27u');
    stdin.write('a');
    await vi.waitFor(() => expect(repository.inspectBackup).toHaveBeenCalledOnce());
    expect(lastFrame()).toContain('正在檢查備份');
    expect(lastFrame()).not.toContain('新增交易');
    expect(lastFrame()).not.toContain('目前總餘額  NT$5,000');

    pendingInspection.resolve(backup);
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
  });

  it('keeps ready restore pending after same-tick y, Escape, and add', async () => {
    const pendingRestore = deferred();
    const pendingReopen = deferred<LedgerRepository>();
    let state: LedgerState = {settings, transactions: []};
    const repository = {
      getState: vi.fn(() => structuredClone(state)),
      inspectBackup: vi.fn(async () => backup),
      restore: vi.fn(async () => {
        await pendingRestore.promise;
        state = {settings, transactions: [transaction]};
      }),
      reload: vi.fn(),
      saveSettings: vi.fn(),
      saveTransactions: vi.fn(),
    } as unknown as LedgerRepository;
    mocks.open.mockReturnValueOnce(pendingReopen.promise);
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    stdin.write('y');
    stdin.write('\u001b[27u');
    stdin.write('a');
    await vi.waitFor(() => expect(repository.restore).toHaveBeenCalledOnce());
    expect(lastFrame()).toContain('正在還原備份');
    expect(lastFrame()).not.toContain('新增交易');
    expect(lastFrame()).not.toContain('目前總餘額  NT$0');

    pendingRestore.resolve();
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledWith('/ledger'));
    expect(lastFrame()).toContain('正在還原備份');
    pendingReopen.resolve({
      getState: vi.fn(() => structuredClone(state)),
    } as unknown as LedgerRepository);
    await vi.waitFor(() => expect(lastFrame()).toContain('目前總餘額  NT$5,000'));
  });

  it('single-flights ready backup inspection and keeps Escape idle until it resolves', async () => {
    const pendingInspection = deferred<BackupInspection>();
    const repository = {
      getState: vi.fn(() => ({settings, transactions: [transaction]})),
      inspectBackup: vi.fn(() => pendingInspection.promise),
      restore: vi.fn(),
      reload: vi.fn(),
      saveSettings: vi.fn(),
      saveTransactions: vi.fn(),
    } as unknown as LedgerRepository;
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() =>
      expect(repository.inspectBackup).toHaveBeenCalledWith('transactions'),
    );
    expect(lastFrame()).toContain('正在檢查備份');
    stdin.write('2');
    stdin.write('\u001b[27u');
    stdin.write('a');
    await nextRender();
    expect(lastFrame()).toContain('正在檢查備份');
    expect(lastFrame()).not.toContain('新增交易');
    expect(repository.inspectBackup).toHaveBeenCalledOnce();

    pendingInspection.resolve(backup);
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    expect(lastFrame()).toContain('交易備份');
    stdin.write('\u001b[27u');
    await nextRender();
    expect(lastFrame()).toContain('目前總餘額  NT$5,000');
    expect(lastFrame()).not.toContain('備份預覽');
  });

  it('does not let a pending ready reload overlap or overwrite a restore flow', async () => {
    const pendingReload = deferred<LedgerInspection>();
    mocks.inspectLedgerRoot
      .mockResolvedValueOnce(invalidInspection)
      .mockReturnValueOnce(pendingReload.promise);
    const repository = {
      getState: vi.fn(() => ({settings, transactions: [transaction]})),
      reload: vi
        .fn()
        .mockRejectedValueOnce(new LedgerValidationError(invalidInspection.issues)),
      inspectBackup: vi.fn(async () => backup),
      saveSettings: vi.fn(),
      saveTransactions: vi.fn(),
    } as unknown as LedgerRepository;
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('p');
    await vi.waitFor(() => expect(lastFrame()).toContain('復原模式'));
    stdin.write('l');
    await vi.waitFor(() => expect(mocks.inspectLedgerRoot).toHaveBeenCalledTimes(2));
    expect(lastFrame()).toContain('正在重新載入');
    stdin.write('r');
    stdin.write('l');
    stdin.write('\u001b[27u');
    await nextRender();
    expect(lastFrame()).toContain('正在重新載入');
    expect(lastFrame()).not.toContain('選擇備份');
    expect(mocks.inspectLedgerRoot).toHaveBeenCalledTimes(2);
    expect(repository.inspectBackup).not.toHaveBeenCalled();

    pendingReload.resolve(invalidInspection);
    await vi.waitFor(() =>
      expect(lastFrame()).not.toContain('正在重新載入'),
    );
    expect(lastFrame()).toContain('復原模式');
    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    expect(repository.inspectBackup).toHaveBeenCalledOnce();
  });

  it('cancels backup selection with Escape without inspecting or restoring', async () => {
    const repository = {
      getState: vi.fn(() => ({settings, transactions: [transaction]})),
      inspectBackup: vi.fn(),
      restore: vi.fn(),
      reload: vi.fn(),
      saveSettings: vi.fn(),
      saveTransactions: vi.fn(),
    } as unknown as LedgerRepository;
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    expect(lastFrame()).toContain('選擇備份');
    stdin.write('\u001b[27u');
    await nextRender();
    expect(lastFrame()).toContain('班費帳本');
    expect(lastFrame()).not.toContain('選擇備份');
    expect(repository.inspectBackup).not.toHaveBeenCalled();
    expect(repository.restore).not.toHaveBeenCalled();
  });

  it('enters blocked recovery when the fresh pre-publish reload is invalid', async () => {
    const reloadFailure = new LedgerValidationError(invalidInspection.issues);
    const repository = {
      getState: vi.fn(() => ({settings, transactions: [transaction]})),
      reload: vi.fn(async () => {
        throw reloadFailure;
      }),
      saveSettings: vi.fn(),
      saveTransactions: vi.fn(),
    } as unknown as LedgerRepository;
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('p');
    await vi.waitFor(() => expect(mocks.inspectLedgerRoot).toHaveBeenCalledWith('/ledger'));
    await vi.waitFor(() => expect(lastFrame()).toContain('復原模式'));
    expect(lastFrame()).toContain('第 3 列');

    stdin.write('a');
    await nextRender();
    expect(lastFrame()).not.toContain('新增交易');
    expect(repository.saveTransactions).not.toHaveBeenCalled();
  });

  it('returns backup cancellation to invalid recovery after a failed check', async () => {
    const repository = {
      getState: vi.fn(() => ({settings, transactions: [transaction]})),
      reload: vi.fn(async () => {
        throw new LedgerValidationError(invalidInspection.issues);
      }),
      saveSettings: vi.fn(),
      saveTransactions: vi.fn(),
    } as unknown as LedgerRepository;
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('p');
    await vi.waitFor(() => expect(lastFrame()).toContain('復原模式'));
    stdin.write('r');
    await nextRender();
    expect(lastFrame()).toContain('選擇備份');
    stdin.write('\u001b[27u');
    await nextRender();
    expect(lastFrame()).toContain('復原模式');
    expect(lastFrame()).not.toContain('篩選：全部交易');

    stdin.write('a');
    await nextRender();
    expect(lastFrame()).not.toContain('新增交易');
    expect(repository.saveTransactions).not.toHaveBeenCalled();
  });

  it('allows backup cancellation to overview only with a valid retained inspection', async () => {
    mocks.inspectLedgerRoot.mockResolvedValueOnce(validInspection);
    const repository = {
      getState: vi.fn(() => ({settings, transactions: [transaction]})),
      reload: vi.fn(async () => {
        throw new Error('transient reload failure');
      }),
      saveSettings: vi.fn(),
      saveTransactions: vi.fn(),
    } as unknown as LedgerRepository;
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('p');
    await vi.waitFor(() => expect(lastFrame()).toContain('復原模式'));
    stdin.write('r');
    await nextRender();
    stdin.write('\u001b[27u');
    await nextRender();
    expect(lastFrame()).toContain('目前總餘額  NT$5,000');
    expect(lastFrame()).toContain('篩選：全部交易');
  });

  it('locks restore cancellation and mutation screens through restore and reopen', async () => {
    const pendingRestore = deferred();
    const pendingReopen = deferred<LedgerRepository>();
    let state: LedgerState = {settings, transactions: []};
    const repository = {
      getState: vi.fn(() => structuredClone(state)),
      inspectBackup: vi.fn(async () => backup),
      restore: vi.fn(async () => {
        await pendingRestore.promise;
        state = {settings, transactions: [transaction]};
      }),
      reload: vi.fn(),
      saveSettings: vi.fn(),
      saveTransactions: vi.fn(),
    } as unknown as LedgerRepository;
    mocks.open.mockReturnValueOnce(pendingReopen.promise);
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    stdin.write('y');
    await vi.waitFor(() => expect(repository.restore).toHaveBeenCalledOnce());
    expect(lastFrame()).toContain('正在還原備份');

    stdin.write('y');
    stdin.write('\u001b[27u');
    stdin.write('a');
    stdin.write('d');
    await nextRender();
    expect(lastFrame()).toContain('正在還原備份');
    expect(lastFrame()).not.toContain('新增交易');
    expect(lastFrame()).not.toContain('刪除交易');
    expect(repository.restore).toHaveBeenCalledOnce();
    expect(repository.saveTransactions).not.toHaveBeenCalled();

    pendingRestore.resolve();
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledWith('/ledger'));
    expect(lastFrame()).toContain('正在還原備份');
    stdin.write('\u001b[27u');
    stdin.write('a');
    await nextRender();
    expect(lastFrame()).toContain('正在還原備份');
    expect(lastFrame()).not.toContain('新增交易');

    pendingReopen.resolve({
      getState: vi.fn(() => structuredClone(state)),
    } as unknown as LedgerRepository);
    await vi.waitFor(() => expect(lastFrame()).toContain('目前總餘額  NT$5,000'));
    stdin.write('d');
    await nextRender();
    expect(lastFrame()).toContain('刪除交易');
    expect(lastFrame()).toContain('期初班費');
  });

  it('uses repository inspection and restore, then refreshes all totals', async () => {
    let state: LedgerState = {settings, transactions: []};
    const repository = {
      getState: vi.fn(() => structuredClone(state)),
      inspectBackup: vi.fn(async () => backup),
      restore: vi.fn(async () => {
        state = {settings, transactions: [transaction]};
      }),
      reload: vi.fn(),
      saveSettings: vi.fn(),
      saveTransactions: vi.fn(),
    } as unknown as LedgerRepository;
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('r');
    await nextRender();
    stdin.write('1');
    await vi.waitFor(() => expect(lastFrame()).toContain('備份預覽'));
    stdin.write('y');
    await vi.waitFor(() => expect(repository.restore).toHaveBeenCalledWith('transactions'));
    await vi.waitFor(() => expect(lastFrame()).toContain('目前總餘額  NT$5,000'));
  });
});
