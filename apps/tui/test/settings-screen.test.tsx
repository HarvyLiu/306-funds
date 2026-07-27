import {
  SourceConflictError,
  type LedgerSettings,
  type LedgerState,
  type Transaction,
} from '@class-fund/ledger';
import type {LedgerRepository} from '@class-fund/ledger/node';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {App} from '../src/app.js';
import {SettingsScreen} from '../src/screens/settings-screen.js';

const settings: LedgerSettings = {
  schema_version: 2,
  currency: 'TWD',
  active_semester: '第一學期',
  default_officer: '我',
  locked_semesters: [],
  semesters: [
    {value: '第一學期', status: 'active'},
    {value: '第二學期', status: 'active'},
  ],
  categories: [
    {value: '期初餘額', status: 'active'},
    {value: '教材與影印', status: 'active'},
    {value: '未被引用的分類', status: 'active'},
  ],
  officers: [
    {value: '我', status: 'active'},
    {value: '另一位總務', status: 'active'},
  ],
};

const transactions: Transaction[] = [
  {
    id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670001',
    date: '2026-08-01',
    semester: '第一學期',
    subject: '期初班費',
    category: '期初餘額',
    type: 'income',
    amount: 4000,
    handled_by: '我',
    note: '',
    created_at: '2026-08-01T08:00:00+08:00',
  },
  {
    id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670002',
    date: '2026-08-17',
    semester: '第一學期',
    subject: '講義',
    category: '教材與影印',
    type: 'expense',
    amount: 1000,
    handled_by: '另一位總務',
    note: '',
    created_at: '2026-08-17T10:00:00+08:00',
  },
  {
    id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670003',
    date: '2026-08-18',
    semester: '第二學期',
    subject: '活動補助',
    category: '期初餘額',
    type: 'income',
    amount: 1000,
    handled_by: '我',
    note: '',
    created_at: '2026-08-18T10:00:00+08:00',
  },
];

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

async function choose(
  stdin: {write(data: string): void},
  value: string,
): Promise<void> {
  stdin.write(value);
  await nextRender();
}

afterEach(() => cleanup());

describe('SettingsScreen', () => {
  it.each([
    {
      action: '1',
      choice: '2',
      assertion: (next: LedgerSettings) =>
        expect(next.active_semester).toBe('第二學期'),
    },
    {
      action: '2',
      choice: '2',
      assertion: (next: LedgerSettings) =>
        expect(next.default_officer).toBe('另一位總務'),
    },
    {
      action: '8',
      choice: '3',
      assertion: (next: LedgerSettings) =>
        expect(next.categories).toContainEqual({
          value: '未被引用的分類',
          status: 'archived',
        }),
    },
  ])('persists a configured settings operation', async ({action, choice, assertion}) => {
    const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
    const {stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, action);
    await choose(stdin, choice);
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    assertion(onSave.mock.calls[0]![0]);
  });

  it.each([
    {
      action: '3',
      value: '第三學期',
      group: 'semesters' as const,
      unchanged: (next: LedgerSettings) =>
        expect(next.active_semester).toBe('第一學期'),
    },
    {
      action: '4',
      value: '王小明',
      group: 'officers' as const,
      unchanged: (next: LedgerSettings) =>
        expect(next.default_officer).toBe('我'),
    },
  ])(
    'adds $value as an active $group option without changing the selected setting',
    async ({action, value, group, unchanged}) => {
      const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
      const {stdin} = render(
        <SettingsScreen
          state={{settings, transactions}}
          onSave={onSave}
          onCancel={vi.fn()}
        />,
      );

      await choose(stdin, action);
      stdin.write(value);
      await nextRender();
      stdin.write('\r');
      await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      const next = onSave.mock.calls[0]![0];
      expect(next[group]).toContainEqual({value, status: 'active'});
      unchanged(next);
    },
  );

  it.each([
    {action: '3', value: '第三學期', group: 'semesters' as const},
    {action: '4', value: '王小明', group: 'officers' as const},
  ])(
    'reactivates the archived $value $group option',
    async ({action, value, group}) => {
      const archivedSettings = structuredClone(settings);
      archivedSettings[group].push({value, status: 'archived'});
      const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
      const {stdin} = render(
        <SettingsScreen
          state={{settings: archivedSettings, transactions}}
          onSave={onSave}
          onCancel={vi.fn()}
        />,
      );

      await choose(stdin, action);
      stdin.write(value);
      await nextRender();
      stdin.write('\r');
      await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
      expect(onSave.mock.calls[0]![0][group]).toEqual(
        expect.arrayContaining([{value, status: 'active'}]),
      );
      expect(
        onSave.mock.calls[0]![0][group].filter(
          (option) => option.value === value,
        ),
      ).toHaveLength(1);
    },
  );

  it.each([
    {action: '3', value: '第一學期', reason: '此學期已存在'},
    {action: '4', value: '我', reason: '此經手人已存在'},
    {action: '5', value: '期初餘額', reason: '此分類已存在'},
  ])(
    'shows the group-specific duplicate message $reason',
    async ({action, value, reason}) => {
      const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
      const {lastFrame, stdin} = render(
        <SettingsScreen
          state={{settings, transactions}}
          onSave={onSave}
          onCancel={vi.fn()}
        />,
      );

      await choose(stdin, action);
      stdin.write(value);
      await nextRender();
      stdin.write('\r');
      await vi.waitFor(() => expect(lastFrame()).toContain(reason));
      expect(onSave).not.toHaveBeenCalled();
    },
  );

  it.each([
    {action: '3', label: '新增學期'},
    {action: '4', label: '新增經手人'},
    {action: '5', label: '新增分類'},
  ])('cancels $label input with Escape without saving', async ({action, label}) => {
    const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
    const onCancel = vi.fn();
    const {lastFrame, stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    await choose(stdin, action);
    stdin.write('尚未儲存');
    await nextRender();
    stdin.write('\u001b[27u');
    await vi.waitFor(() => expect(lastFrame()).toContain(label));
    expect(onSave).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('clears cancelled text before another add action', async () => {
    const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
    const {stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, '3');
    stdin.write('殘留文字');
    await nextRender();
    stdin.write('\u001b[27u');
    await nextRender();
    await choose(stdin, '4');
    stdin.write('王小華');
    await nextRender();
    stdin.write('\r');

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![0].officers).toContainEqual({
      value: '王小華',
      status: 'active',
    });
  });

  it('adds the 場地費 category', async () => {
    const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
    const {stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, '5');
    stdin.write('場地費');
    await nextRender();
    stdin.write('\r');
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![0].categories).toContainEqual({
      value: '場地費',
      status: 'active',
    });
  });

  it('locks text input, cancellation, and resubmission until saving settles', async () => {
    const pendingSave = deferred();
    const onSave = vi.fn(() => pendingSave.promise);
    const onCancel = vi.fn();
    const {lastFrame, stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    await choose(stdin, '5');
    stdin.write('場地費');
    await nextRender();
    stdin.write('\r');
    await vi.waitFor(() =>
      expect(lastFrame()).toContain('正在儲存設定'),
    );

    stdin.write('改');
    stdin.write('\u001b[27u');
    stdin.write('\r');
    await nextRender();

    expect(lastFrame()).toContain('場地費');
    expect(lastFrame()).not.toContain('場地費改');
    expect(lastFrame()).toContain('正在儲存設定');
    expect(onSave).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();

    pendingSave.resolve();
    await vi.waitFor(() => expect(lastFrame()).toContain('設定已儲存'));
    stdin.write('改');
    await nextRender();
    expect(lastFrame()).toContain('場地費改');
  });

  it('locks option navigation, cancellation, and selection until saving settles', async () => {
    const pendingSave = deferred();
    const onSave = vi.fn(() => pendingSave.promise);
    const onCancel = vi.fn();
    const {lastFrame, stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    await choose(stdin, '1');
    await choose(stdin, '2');
    await vi.waitFor(() =>
      expect(lastFrame()).toContain('正在儲存設定'),
    );
    expect(lastFrame()).toContain('❯ 第一學期');

    stdin.write('j');
    stdin.write('1');
    stdin.write('\r');
    stdin.write('\u001b[27u');
    await nextRender();

    expect(lastFrame()).toContain('❯ 第一學期');
    expect(lastFrame()).toContain('正在儲存設定');
    expect(onSave).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();

    pendingSave.resolve();
    await vi.waitFor(() => expect(lastFrame()).toContain('設定已儲存'));
    stdin.write('j');
    await nextRender();
    expect(lastFrame()).toContain('❯ 第二學期');
  });

  it.each([
    {action: '7', choice: '1', reason: '目前學期不可封存'},
    {action: '8', choice: '2', reason: '此分類已被交易引用，無法封存'},
    {action: '9', choice: '1', reason: '預設經手人不可封存'},
  ])('shows a refusal reason without saving', async ({action, choice, reason}) => {
    const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
    const {lastFrame, stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, action);
    await choose(stdin, choice);
    expect(lastFrame()).toContain(reason);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows the semester lock action and active lock statuses', async () => {
    const lockedSettings = structuredClone(settings);
    lockedSettings.locked_semesters = ['第二學期'];
    const {lastFrame, stdin} = render(
      <SettingsScreen
        state={{settings: lockedSettings, transactions}}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('學期鎖定狀態');
    await choose(stdin, '6');
    expect(lastFrame()).toContain('第一學期（未鎖定）');
    expect(lastFrame()).toContain('第二學期（已鎖定）');
  });

  it('locks a non-current semester and persists the next settings', async () => {
    const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
    const {stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, '6');
    await choose(stdin, '2');
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![0].locked_semesters).toEqual(['第二學期']);
  });

  it('unlocks a non-current locked semester and persists the next settings', async () => {
    const lockedSettings = structuredClone(settings);
    lockedSettings.locked_semesters = ['第二學期'];
    const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
    const {stdin} = render(
      <SettingsScreen
        state={{settings: lockedSettings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, '6');
    await choose(stdin, '2');
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0]![0].locked_semesters).toEqual([]);
  });

  it('refuses to lock the current semester without saving', async () => {
    const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
    const {lastFrame, stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, '6');
    await choose(stdin, '1');
    expect(lastFrame()).toContain('目前學期不可鎖定');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('omits locked active semesters from the current semester selector', async () => {
    const lockedSettings = structuredClone(settings);
    lockedSettings.locked_semesters = ['第二學期'];
    const {lastFrame, stdin} = render(
      <SettingsScreen
        state={{settings: lockedSettings, transactions}}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, '1');
    expect(lastFrame()).toContain('第一學期');
    expect(lastFrame()).not.toContain('第二學期');
  });

  it('refuses to archive a locked semester without saving', async () => {
    const lockedSettings = structuredClone(settings);
    lockedSettings.locked_semesters = ['第二學期'];
    const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
    const {lastFrame, stdin} = render(
      <SettingsScreen
        state={{settings: lockedSettings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, '7');
    await choose(stdin, '2');
    expect(lastFrame()).toContain('已鎖定學期不可封存，請先解鎖');
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'source conflict',
      error: new SourceConflictError('/private/settings.json'),
      message: '檔案已被外部修改。請重新載入後再試。',
    },
    {
      name: 'generic save failure',
      error: new Error('permission denied'),
      message: '無法儲存設定，請確認檔案權限後再試。',
    },
  ])('shows $name while saving a semester lock change', async ({error, message}) => {
    const onSave = vi.fn(async (_next: LedgerSettings) => {
      throw error;
    });
    const {lastFrame, stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, '6');
    await choose(stdin, '2');
    await vi.waitFor(() => expect(lastFrame()).toContain(message));
    expect(lastFrame()).not.toContain('設定已儲存');
  });

  it('prevents repeated semester lock selection while saving', async () => {
    const pendingSave = deferred();
    const onSave = vi.fn(() => pendingSave.promise);
    const {lastFrame, stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, '6');
    await choose(stdin, '2');
    await vi.waitFor(() => expect(lastFrame()).toContain('正在儲存設定'));
    await choose(stdin, '2');
    expect(onSave).toHaveBeenCalledOnce();

    pendingSave.resolve();
    await vi.waitFor(() => expect(lastFrame()).toContain('設定已儲存'));
  });

  it('passes the saved lock settings to onSaved', async () => {
    const onSave = vi.fn(async (_next: LedgerSettings) => undefined);
    const onSaved = vi.fn();
    const {stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
        onSaved={onSaved}
      />,
    );

    await choose(stdin, '6');
    await choose(stdin, '2');
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({locked_semesters: ['第二學期']}),
    );
  });

  it('does not claim a save after a source conflict', async () => {
    const onSave = vi.fn(async (_next: LedgerSettings) => {
      throw new SourceConflictError('/private/settings.json');
    });
    const {lastFrame, stdin} = render(
      <SettingsScreen
        state={{settings, transactions}}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    await choose(stdin, '5');
    stdin.write('場地費');
    await nextRender();
    stdin.write('\r');
    await vi.waitFor(() =>
      expect(lastFrame()).toContain('檔案已被外部修改。請重新載入後再試。'),
    );
    expect(lastFrame()).not.toContain('設定已儲存');
    expect(lastFrame()).not.toContain('/private/settings.json');
  });
});

describe('settings entry point', () => {
  it('opens with s and persists through the repository before returning', async () => {
    let state: LedgerState = {settings, transactions};
    const saveSettings = vi.fn(async (next: LedgerSettings) => {
      state = {...state, settings: structuredClone(next)};
    });
    const repository = {
      getState: vi.fn(() => structuredClone(state)),
      reload: vi.fn(),
      saveSettings,
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

    stdin.write('s');
    await nextRender();
    expect(lastFrame()).toContain('帳本設定');
    await choose(stdin, '1');
    await choose(stdin, '2');
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(lastFrame()).toContain('班費帳本'));
    expect(saveSettings.mock.calls[0]![0].active_semester).toBe('第二學期');
  });
});

describe('pre-publish check', () => {
  it('locks cancel and mutation navigation until reload installs fresh state', async () => {
    const pendingReload = deferred();
    const freshTransactions = transactions;
    let state: LedgerState = {settings, transactions: []};
    const reload = vi.fn(async () => {
      await pendingReload.promise;
      state = {settings, transactions: freshTransactions};
    });
    const repository = {
      getState: vi.fn(() => structuredClone(state)),
      reload,
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
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(lastFrame()).toContain('正在重新載入並檢查資料');

    stdin.write('\r');
    stdin.write('\u001b[27u');
    stdin.write('a');
    stdin.write('d');
    await nextRender();
    expect(lastFrame()).toContain('正在重新載入並檢查資料');
    expect(lastFrame()).not.toContain('新增交易');
    expect(lastFrame()).not.toContain('刪除交易');
    expect(repository.saveTransactions).not.toHaveBeenCalled();

    pendingReload.resolve();
    await vi.waitFor(() => expect(lastFrame()).toContain('資料檢查通過'));
    expect(lastFrame()).toContain('交易筆數 3');
    expect(lastFrame()).toContain('目前總餘額 NT$4,000');

    stdin.write('\r');
    await vi.waitFor(() => expect(lastFrame()).toContain('目前總餘額  NT$4,000'));
    expect(lastFrame()).toContain('活動補助');
  });

  it('reloads before showing the fresh count and overall totals', async () => {
    const freshTransactions = transactions;
    let state: LedgerState = {settings, transactions: []};
    const reload = vi.fn(async () => {
      state = {settings, transactions: freshTransactions};
    });
    const repository = {
      getState: vi.fn(() => structuredClone(state)),
      reload,
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
    await vi.waitFor(() => expect(lastFrame()).toContain('資料檢查通過'));
    expect(reload).toHaveBeenCalledOnce();
    expect(lastFrame()).toContain('交易筆數 3');
    expect(lastFrame()).toContain('總收入 NT$5,000');
    expect(lastFrame()).toContain('總支出 NT$1,000');
    expect(lastFrame()).toContain('目前總餘額 NT$4,000');
  });
});
