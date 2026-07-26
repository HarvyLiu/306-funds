import {existsSync} from 'node:fs';
import * as fs from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';

import type {
  LedgerSettings,
  LedgerState,
  Transaction,
} from '@class-fund/ledger';
import type {LedgerRepository} from '@class-fund/ledger/node';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {App} from '../src/app.js';
import {
  hasSetupMarker,
  setupMarkerPath,
  writeSetupMarker,
} from '../src/setup-marker.js';
import {SetupScreen} from '../src/screens/setup-screen.js';

const starterSettings: LedgerSettings = {
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
  ],
  officers: [
    {value: '我', status: 'active'},
    {value: '另一位總務', status: 'active'},
  ],
};

const referencedTransactions: Transaction[] = [
  {
    id: 'semester-and-primary-officer',
    date: '2025-09-01',
    semester: '第一學期',
    subject: '期初班費',
    category: '期初餘額',
    type: 'income',
    amount: 5000,
    handled_by: '我',
    note: '',
    created_at: '2025-09-01T08:00:00+08:00',
  },
  {
    id: 'other-officer',
    date: '2025-09-02',
    semester: '第一學期',
    subject: '影印',
    category: '教材與影印',
    type: 'expense',
    amount: 300,
    handled_by: '另一位總務',
    note: '',
    created_at: '2025-09-02T08:00:00+08:00',
  },
];

interface WritableStdin {
  write(data: string): void;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  cleanup();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, {recursive: true})),
  );
});

async function makeTemporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'class-fund-setup-'));
  temporaryRoots.push(root);
  return root;
}

async function clearInput(stdin: WritableStdin, value: string): Promise<void> {
  for (const _character of value) {
    stdin.write('\u007f');
    await new Promise<void>((done) => setImmediate(done));
  }
}

async function replaceAndSubmit(
  stdin: WritableStdin,
  previous: string,
  next: string,
): Promise<void> {
  await clearInput(stdin, previous);
  stdin.write(next);
  await new Promise<void>((done) => setImmediate(done));
  stdin.write('\r');
  await new Promise<void>((done) => setImmediate(done));
}

async function waitForAssertion(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, {timeout: 1000, interval: 5});
}

async function nextRender(): Promise<void> {
  await new Promise<void>((done) => setImmediate(done));
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

function fakeRepository(
  settings = starterSettings,
  transactions: Transaction[] = [],
) {
  let state: LedgerState = {
    settings: structuredClone(settings),
    transactions: structuredClone(transactions),
  };
  const getState = vi.fn((): LedgerState => structuredClone(state));
  const saveSettings = vi.fn(async (next: LedgerSettings): Promise<void> => {
    state = {...state, settings: structuredClone(next)};
  });
  return {
    repository: {getState, saveSettings} as unknown as LedgerRepository,
    getState,
    saveSettings,
  };
}

function fileSystemProxy(
  overrides: Partial<Record<keyof typeof fs, unknown>>,
): typeof fs {
  return new Proxy(fs, {
    get(target, property, receiver) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return overrides[property as keyof typeof fs];
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function instrumentHandle(
  handle: FileHandle,
  label: string,
  events: string[],
): FileHandle {
  return new Proxy(handle, {
    get(target, property, receiver) {
      if (property === 'writeFile') {
        return async (...args: unknown[]) => {
          events.push(`write:${label}`);
          return (target.writeFile as (...values: unknown[]) => Promise<unknown>)(
            ...args,
          );
        };
      }
      if (property === 'sync') {
        return async () => {
          events.push(`sync:${label}`);
          return target.sync();
        };
      }
      if (property === 'close') {
        return async () => {
          events.push(`close:${label}`);
          return target.close();
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

describe('SetupScreen', () => {
  it('collects three values and submits one validated settings object', async () => {
    const onSubmit = vi.fn();
    const {lastFrame, stdin} = render(
      <SetupScreen
        settings={starterSettings}
        transactions={[]}
        onSubmit={onSubmit}
      />,
    );

    expect(lastFrame()).toContain('初始設定');
    expect(lastFrame()).toContain('第一學期');
    await replaceAndSubmit(stdin, '第一學期', '114學年度第一學期');
    await replaceAndSubmit(stdin, '我', '王小明');
    await replaceAndSubmit(stdin, '另一位總務', '李小華');

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      schema_version: 2,
      currency: 'TWD',
      active_semester: '114學年度第一學期',
      default_officer: '王小明',
      locked_semesters: [],
      semesters: [{value: '114學年度第一學期', status: 'active'}],
      categories: starterSettings.categories,
      officers: [
        {value: '王小明', status: 'active'},
        {value: '李小華', status: 'active'},
      ],
    });
  });

  it('ignores repeated final-step submissions until persistence settles', async () => {
    const pending = deferred();
    const onSubmit = vi.fn(() => pending.promise);
    const {lastFrame, stdin} = render(
      <SetupScreen
        settings={starterSettings}
        transactions={[]}
        onSubmit={onSubmit}
      />,
    );

    await replaceAndSubmit(stdin, '第一學期', '114學年度第一學期');
    await replaceAndSubmit(stdin, '我', '王小明');
    await replaceAndSubmit(stdin, '另一位總務', '李小華');
    stdin.write('\r');
    stdin.write('\r');
    await nextRender();

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(lastFrame()).toContain('正在儲存初始設定');

    pending.resolve();
    await waitForAssertion(() =>
      expect(lastFrame()).not.toContain('正在儲存初始設定'),
    );
    stdin.write('\r');
    await nextRender();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('disables editing, cancellation, and submission while persistence is pending', async () => {
    const pending = deferred();
    const onSubmit = vi.fn(() => pending.promise);
    const onCancel = vi.fn();
    const {lastFrame, stdin} = render(
      <SetupScreen
        settings={starterSettings}
        transactions={[]}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    await replaceAndSubmit(stdin, '第一學期', '114學年度第一學期');
    await replaceAndSubmit(stdin, '我', '王小明');
    await replaceAndSubmit(stdin, '另一位總務', '李小華');
    expect(lastFrame()).toContain('正在儲存初始設定');

    stdin.write('改');
    stdin.write('\u001b[27u');
    stdin.write('\r');
    await nextRender();

    expect(lastFrame()).toContain('李小華');
    expect(lastFrame()).not.toContain('李小華改');
    expect(onCancel).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledOnce();

    pending.resolve();
    await waitForAssertion(() =>
      expect(lastFrame()).not.toContain('正在儲存初始設定'),
    );
  });

  it('handles a late submission rejection after unmount', async () => {
    const pending = deferred();
    const onSubmit = vi.fn(() => pending.promise);
    const rendered = render(
      <SetupScreen
        settings={starterSettings}
        transactions={[]}
        onSubmit={onSubmit}
      />,
    );

    await replaceAndSubmit(
      rendered.stdin,
      '第一學期',
      '114學年度第一學期',
    );
    await replaceAndSubmit(rendered.stdin, '我', '王小明');
    await replaceAndSubmit(rendered.stdin, '另一位總務', '李小華');
    expect(onSubmit).toHaveBeenCalledOnce();

    rendered.unmount();
    pending.reject(new Error('late failure'));
    await expect(pending.promise).rejects.toThrow('late failure');
    await nextRender();
  });

  it('allows retry after an asynchronous setup submission fails', async () => {
    const pending = deferred();
    const onSubmit = vi
      .fn<(settings: LedgerSettings) => Promise<void>>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined);
    const {lastFrame, stdin} = render(
      <SetupScreen
        settings={starterSettings}
        transactions={[]}
        onSubmit={onSubmit}
      />,
    );

    await replaceAndSubmit(stdin, '第一學期', '114學年度第一學期');
    await replaceAndSubmit(stdin, '我', '王小明');
    await replaceAndSubmit(stdin, '另一位總務', '李小華');
    pending.reject(new Error('save failed'));

    await waitForAssertion(() => expect(lastFrame()).toContain('請再試一次'));
    stdin.write('\r');
    await nextRender();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('archives referenced starter values and adds the entered active values', async () => {
    const onSubmit = vi.fn();
    const {stdin} = render(
      <SetupScreen
        settings={starterSettings}
        transactions={referencedTransactions}
        onSubmit={onSubmit}
      />,
    );

    await replaceAndSubmit(stdin, '第一學期', '114學年度第一學期');
    await replaceAndSubmit(stdin, '我', '王小明');
    await replaceAndSubmit(stdin, '另一位總務', '李小華');

    const submitted = onSubmit.mock.calls[0]?.[0] as LedgerSettings;
    expect(submitted.semesters).toEqual([
      {value: '第一學期', status: 'archived'},
      {value: '114學年度第一學期', status: 'active'},
    ]);
    expect(submitted.officers).toEqual([
      {value: '我', status: 'archived'},
      {value: '另一位總務', status: 'archived'},
      {value: '王小明', status: 'active'},
      {value: '李小華', status: 'active'},
    ]);
    expect(submitted.categories).toEqual(starterSettings.categories);
  });

  it('keeps matching starter entries active without duplicating them', async () => {
    const onSubmit = vi.fn();
    const {stdin} = render(
      <SetupScreen
        settings={starterSettings}
        transactions={referencedTransactions}
        onSubmit={onSubmit}
      />,
    );

    for (let step = 0; step < 3; step += 1) {
      stdin.write('\r');
      await new Promise<void>((done) => setImmediate(done));
    }

    const submitted = onSubmit.mock.calls[0]?.[0] as LedgerSettings;
    expect(submitted.semesters).toEqual([
      {value: '第一學期', status: 'active'},
    ]);
    expect(submitted.officers).toEqual([
      {value: '我', status: 'active'},
      {value: '另一位總務', status: 'active'},
    ]);
  });

  it('keeps a blank semester on the current step and shows an error', async () => {
    const onSubmit = vi.fn();
    const {lastFrame, stdin} = render(
      <SetupScreen
        settings={starterSettings}
        transactions={[]}
        onSubmit={onSubmit}
      />,
    );

    await clearInput(stdin, '第一學期');
    stdin.write('\r');
    await new Promise<void>((done) => setImmediate(done));

    expect(lastFrame()).toContain('步驟 1/3');
    expect(lastFrame()).toContain('學期不可空白');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps a trim-invalid officer on the current step and shows an error', async () => {
    const onSubmit = vi.fn();
    const {lastFrame, stdin} = render(
      <SetupScreen
        settings={starterSettings}
        transactions={[]}
        onSubmit={onSubmit}
      />,
    );

    await replaceAndSubmit(stdin, '第一學期', '114學年度第一學期');
    await clearInput(stdin, '我');
    stdin.write(' 王小明');
    await new Promise<void>((done) => setImmediate(done));
    stdin.write('\r');
    await new Promise<void>((done) => setImmediate(done));

    expect(lastFrame()).toContain('步驟 2/3');
    expect(lastFrame()).toContain('前後不可有空格');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls the optional cancel action safely on Escape', async () => {
    const onCancel = vi.fn();
    const {stdin} = render(
      <SetupScreen
        settings={starterSettings}
        transactions={[]}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );

    stdin.write('\u001b[27u');
    await new Promise<void>((done) => setImmediate(done));

    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('setup marker', () => {
  it('uses .local/setup-complete and changes from absent to present', async () => {
    const root = await makeTemporaryRoot();

    expect(setupMarkerPath(root)).toBe(
      resolve(root, '.local/setup-complete'),
    );
    await expect(hasSetupMarker(root)).resolves.toBe(false);

    await writeSetupMarker(root);

    await expect(hasSetupMarker(root)).resolves.toBe(true);
    await expect(fs.readFile(setupMarkerPath(root), 'utf8')).resolves.toBe(
      'complete\n',
    );
  });

  it('cleans its unique temporary file when the atomic rename fails', async () => {
    const root = await makeTemporaryRoot();
    await fs.mkdir(setupMarkerPath(root), {recursive: true});

    await expect(writeSetupMarker(root)).rejects.toBeDefined();

    expect(await fs.readdir(join(root, '.local'))).toEqual(['setup-complete']);
    await expect(hasSetupMarker(root)).resolves.toBe(false);
  });
});

describe('setup marker durability', () => {
  it('syncs a newly created .local entry before staging and syncs it after rename', async () => {
    const root = await makeTemporaryRoot();
    const local = join(root, '.local');
    const events: string[] = [];
    const fileSystem = fileSystemProxy({
      mkdir: async (...args: unknown[]) => {
        events.push('mkdir:local');
        return (fs.mkdir as (...values: unknown[]) => Promise<unknown>)(...args);
      },
      open: async (...args: unknown[]) => {
        const path = String(args[0]);
        const label = path === root ? 'root' : path === local ? 'local' : 'temp';
        events.push(`open:${label}`);
        const handle = await (
          fs.open as (...values: unknown[]) => Promise<FileHandle>
        )(...args);
        return instrumentHandle(handle, label, events);
      },
      rename: async (...args: unknown[]) => {
        events.push('rename:marker');
        return (fs.rename as (...values: unknown[]) => Promise<void>)(...args);
      },
    });

    await writeSetupMarker(root, {
      fileSystem,
      createTemporarySuffix: () => 'ordered',
    });

    expect(events).toEqual([
      'mkdir:local',
      'open:root',
      'sync:root',
      'close:root',
      'open:temp',
      'write:temp',
      'sync:temp',
      'close:temp',
      'rename:marker',
      'open:local',
      'sync:local',
      'close:local',
    ]);
  });

  it('preserves a directory sync failure when closing the directory also fails', async () => {
    const root = await makeTemporaryRoot();
    const local = join(root, '.local');
    await fs.mkdir(local);
    const syncError = new Error('directory sync failed');
    const closeError = new Error('directory close failed');
    const fileSystem = fileSystemProxy({
      open: async (...args: unknown[]) => {
        if (String(args[0]) === local && args[1] === 'r') {
          return {
            sync: async () => Promise.reject(syncError),
            close: async () => Promise.reject(closeError),
          } as unknown as FileHandle;
        }
        return (fs.open as (...values: unknown[]) => Promise<FileHandle>)(
          ...args,
        );
      },
    });

    await expect(
      writeSetupMarker(root, {
        fileSystem,
        createTemporarySuffix: () => 'sync-failure',
      }),
    ).rejects.toBe(syncError);
  });

  it('does not remove a colliding temporary file it did not create', async () => {
    const root = await makeTemporaryRoot();
    const marker = setupMarkerPath(root);
    await fs.mkdir(join(root, '.local'));
    const collision = join(
      root,
      '.local',
      `.${basename(marker)}.collision.tmp`,
    );
    await fs.writeFile(collision, 'owned elsewhere');

    await expect(
      writeSetupMarker(root, {createTemporarySuffix: () => 'collision'}),
    ).rejects.toMatchObject({code: 'EEXIST'});
    await expect(fs.readFile(collision, 'utf8')).resolves.toBe('owned elsewhere');
  });
});

describe('App setup persistence', () => {
  it('saves settings, writes the marker, refreshes state, and opens overview in order', async () => {
    const root = await makeTemporaryRoot();
    const fake = fakeRepository();
    const events: string[] = [];
    let persistedSettings = structuredClone(starterSettings);
    fake.getState.mockImplementation(() => {
      events.push(
        `refresh:${existsSync(setupMarkerPath(root)) ? 'marker' : 'no-marker'}`,
      );
      return {
        settings: structuredClone(persistedSettings),
        transactions: [],
      };
    });
    fake.saveSettings.mockImplementation(async (next: LedgerSettings) => {
      events.push('save');
      await expect(hasSetupMarker(root)).resolves.toBe(false);
      persistedSettings = structuredClone(next);
    });
    const {lastFrame, stdin} = render(
      <App
        root={root}
        repository={fake.repository}
        setupComplete={false}
        onExit={vi.fn()}
      />,
    );
    events.length = 0;

    await replaceAndSubmit(stdin, '第一學期', '114學年度第一學期');
    await replaceAndSubmit(stdin, '我', '王小明');
    await replaceAndSubmit(stdin, '另一位總務', '李小華');

    await waitForAssertion(() => expect(lastFrame()).toContain('目前總餘額'));
    await expect(hasSetupMarker(root)).resolves.toBe(true);
    expect(fake.saveSettings).toHaveBeenCalledOnce();
    expect(events).toEqual(['save', 'refresh:marker']);
  });

  it('shows an error and never writes the marker when settings persistence fails', async () => {
    const root = await makeTemporaryRoot();
    const fake = fakeRepository();
    fake.saveSettings.mockRejectedValueOnce(new Error('disk unavailable'));
    const {lastFrame, stdin} = render(
      <App
        root={root}
        repository={fake.repository}
        setupComplete={false}
        onExit={vi.fn()}
      />,
    );

    await replaceAndSubmit(stdin, '第一學期', '114學年度第一學期');
    await replaceAndSubmit(stdin, '我', '王小明');
    await replaceAndSubmit(stdin, '另一位總務', '李小華');

    await waitForAssertion(() =>
      expect(lastFrame()).toContain('無法儲存初始設定'),
    );
    await expect(hasSetupMarker(root)).resolves.toBe(false);
    expect(fake.saveSettings).toHaveBeenCalledOnce();
    expect(lastFrame()).toContain('初始設定');
  });

  it('keeps setup without refreshing until marker retry succeeds', async () => {
    const root = await makeTemporaryRoot();
    await fs.mkdir(setupMarkerPath(root), {recursive: true});
    const fake = fakeRepository();
    const {lastFrame, stdin} = render(
      <App
        root={root}
        repository={fake.repository}
        setupComplete={false}
        onExit={vi.fn()}
      />,
    );

    await replaceAndSubmit(stdin, '第一學期', '114學年度第一學期');
    await replaceAndSubmit(stdin, '我', '王小明');
    await replaceAndSubmit(stdin, '另一位總務', '李小華');

    await waitForAssertion(() =>
      expect(lastFrame()).toContain(
        '設定已儲存，但無法建立初始設定標記',
      ),
    );
    expect(lastFrame()).toContain('初始設定');
    expect(lastFrame()).toContain('李小華');
    expect(fake.saveSettings).toHaveBeenCalledOnce();
    expect(fake.getState).toHaveBeenCalledOnce();

    await fs.rm(setupMarkerPath(root), {recursive: true});
    await nextRender();
    stdin.write('\r');
    await waitForAssertion(() => expect(lastFrame()).toContain('目前總餘額'));
    expect(fake.saveSettings).toHaveBeenCalledTimes(2);
    expect(fake.getState).toHaveBeenCalledTimes(2);
    await expect(hasSetupMarker(root)).resolves.toBe(true);
  });
});
