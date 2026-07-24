import * as fs from 'node:fs/promises';
import type {PathLike} from 'node:fs';
import type {FileHandle} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

import {
  LedgerValidationError,
  previewAdd,
  serializeSettings,
  serializeTransactionsCsv,
  type LedgerSettings,
  type Transaction,
  type TransactionInput,
} from '../src/index.js';
import {
  inspectLedgerBackup,
  inspectLedgerRoot,
  ledgerPaths,
  LedgerRepository,
  MissingBackupError,
  restoreLedgerBackup,
  SourceConflictError,
  type RepositoryDependencies,
} from '../src/node.js';
import {validSettings} from './fixture-settings.js';

const openingTransaction: Transaction = {
  id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670001',
  date: '2026-08-01',
  semester: '第一學期',
  subject: '期初班費',
  category: '期初餘額',
  type: 'income',
  amount: 500,
  handled_by: '我',
  note: '',
  created_at: '2026-08-01T09:00:00+08:00',
};

const expense: TransactionInput = {
  date: '2026-08-17',
  semester: '第一學期',
  subject: '講義',
  category: '教材與影印',
  type: 'expense',
  amount: 100,
  handled_by: '我',
  note: '',
};

const mutationDependencies = {
  createId: () => '6ed1a6b4-1ca2-45ce-91a3-2f53e55604c2',
  now: () => '2026-08-17T10:00:00+08:00',
};

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true})));
});

async function createRoot(
  settings: LedgerSettings = validSettings,
  transactions: Transaction[] = [openingTransaction],
): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'class-fund-'));
  roots.push(root);
  await fs.mkdir(join(root, 'data'));
  await Promise.all([
    fs.writeFile(join(root, 'data/settings.json'), serializeSettings(settings)),
    fs.writeFile(
      join(root, 'data/transactions.csv'),
      serializeTransactionsCsv(transactions, settings),
    ),
  ]);
  return root;
}

async function readUtf8(path: string): Promise<string> {
  return fs.readFile(path, 'utf8');
}

function malformedReplacementBytes(
  text: string,
  replacementBytes: number | readonly number[],
): Buffer {
  const bytes = Buffer.from(text);
  const replacement = Buffer.from('\ufffd');
  const index = bytes.indexOf(replacement);
  if (index === -1) throw new Error('Fixture must contain a replacement character');
  const malformed = Buffer.from(
    typeof replacementBytes === 'number'
      ? [replacementBytes]
      : replacementBytes,
  );
  return Buffer.concat([
    bytes.subarray(0, index),
    malformed,
    bytes.subarray(index + replacement.length),
  ]);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function temporaryFiles(root: string): Promise<string[]> {
  const directories = [join(root, 'data'), join(root, '.local/backups')];
  const entries = await Promise.all(
    directories.map(async (directory) => {
      try {
        return await fs.readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    }),
  );
  return entries.flat().filter((entry) => entry.endsWith('.tmp'));
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

describe('ledger repository paths and state', () => {
  test('resolves canonical source and backup paths', () => {
    const root = join('relative', 'ledger');

    expect(ledgerPaths(root)).toEqual({
      settings: resolve(root, 'data/settings.json'),
      transactions: resolve(root, 'data/transactions.csv'),
      settingsBackup: resolve(root, '.local/backups/settings.json'),
      transactionsBackup: resolve(root, '.local/backups/transactions.csv'),
    });
  });

  test('opens valid files, returns owned state, saves a preview, and backs up the source', async () => {
    const root = await createRoot();
    const repository = await LedgerRepository.open(root);

    const first = repository.getState();
    expect(first).toEqual({
      settings: validSettings,
      transactions: [openingTransaction],
    });
    first.settings.active_semester = '第二學期';
    first.transactions[0]!.subject = 'caller mutation';
    expect(repository.getState()).toEqual({
      settings: validSettings,
      transactions: [openingTransaction],
    });

    const preview = previewAdd(repository.getState(), expense, mutationDependencies);
    await repository.saveTransactions(preview.nextTransactions);

    expect((await LedgerRepository.open(root)).getState().transactions).toHaveLength(2);
    expect(
      await readUtf8(join(root, '.local/backups/transactions.csv')),
    ).toContain(openingTransaction.id);
  });

  test('reload accepts an external valid edit and refreshes conflict hashes', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const repository = await LedgerRepository.open(root);
    const external = previewAdd(
      repository.getState(),
      expense,
      mutationDependencies,
    ).nextTransactions;
    await fs.writeFile(
      paths.transactions,
      serializeTransactionsCsv(external, validSettings),
    );

    await repository.reload();
    expect(repository.getState().transactions).toEqual(external);

    const next = external.map((transaction) => ({...transaction, note: 'reloaded'}));
    await expect(repository.saveTransactions(next)).resolves.toBeUndefined();
    expect((await LedgerRepository.open(root)).getState().transactions).toEqual(next);
  });

  test('keeps the root resolved by inspection when cwd changes during open', async () => {
    const root = await createRoot();
    const originalCwd = process.cwd();
    const alternateCwd = await fs.mkdtemp(join(tmpdir(), 'class-fund-cwd-'));
    roots.push(alternateCwd);
    process.chdir(dirname(root));
    let changedCwd = false;
    const dependencies: RepositoryDependencies = {
      fileSystem: fileSystemProxy({
        readFile: async (...args: unknown[]) => {
          if (!changedCwd) {
            changedCwd = true;
            process.chdir(alternateCwd);
          }
          return (fs.readFile as (...values: unknown[]) => Promise<unknown>)(
            ...args,
          );
        },
      }),
    };

    try {
      const repository = await LedgerRepository.open(basename(root), dependencies);
      process.chdir(originalCwd);
      await repository.saveTransactions([
        {...openingTransaction, note: 'resolved root'},
      ]);
    } finally {
      process.chdir(originalCwd);
    }

    expect(await readUtf8(ledgerPaths(root).transactions)).toContain(
      'resolved root',
    );
  });

  test('serializes concurrent incompatible saves on one repository instance', async () => {
    const root = await createRoot(validSettings, []);
    let activeMkdir = 0;
    let maximumMkdir = 0;
    const repository = await LedgerRepository.open(root, {
      fileSystem: fileSystemProxy({
        mkdir: async (...args: unknown[]) => {
          activeMkdir += 1;
          maximumMkdir = Math.max(maximumMkdir, activeMkdir);
          await new Promise<void>((resolveDelay) => setImmediate(resolveDelay));
          try {
            return await (
              fs.mkdir as (...values: unknown[]) => Promise<unknown>
            )(...args);
          } finally {
            activeMkdir -= 1;
          }
        },
      }),
    });
    const nextSettings = structuredClone(validSettings);
    nextSettings.categories = nextSettings.categories.filter(
      ({value}) => value !== '教材與影印',
    );
    const incompatibleTransaction: Transaction = {
      ...openingTransaction,
      category: '教材與影印',
    };

    const results = await Promise.allSettled([
      repository.saveSettings(nextSettings),
      repository.saveTransactions([incompatibleTransaction]),
    ]);

    expect(results[0]).toMatchObject({status: 'fulfilled'});
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: expect.any(LedgerValidationError),
    });
    expect(maximumMkdir).toBe(1);
    expect((await LedgerRepository.open(root)).getState()).toEqual({
      settings: nextSettings,
      transactions: [],
    });
  });
});

describe('inspection and validation', () => {
  test('returns typed issues for invalid JSON and CSV without rewriting raw sources', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const settingsText = '{"student":"private"';
    const transactionsText = 'not,the,canonical,header\nprivate,row\n';
    await Promise.all([
      fs.writeFile(paths.settings, settingsText),
      fs.writeFile(paths.transactions, transactionsText),
    ]);

    const inspection = await inspectLedgerRoot(root);

    expect(inspection.settingsText).toBe(settingsText);
    expect(inspection.transactionsText).toBe(transactionsText);
    expect(inspection.state).toBeNull();
    expect(inspection.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: 'settings', field: 'json'}),
        expect.objectContaining({source: 'transactions', field: 'header'}),
      ]),
    );
    expect(await readUtf8(paths.settings)).toBe(settingsText);
    expect(await readUtf8(paths.transactions)).toBe(transactionsText);
    expect(JSON.stringify(inspection.issues)).not.toContain('private');
  });

  test.each([
    ['settings', 'settings'] as const,
    ['transactions', 'transactions'] as const,
  ])('reports a source-matching file issue when %s is missing', async (key, source) => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    await fs.rm(paths[key]);

    const inspection = await inspectLedgerRoot(root);

    expect(inspection.state).toBeNull();
    expect(inspection.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source, field: 'file'}),
      ]),
    );
    expect(inspection[`${key}Text`]).toBeNull();
  });

  test('returns owned inspection and backup state', async () => {
    const backupTransaction = {...openingTransaction, amount: 5000};
    const root = await createRoot(validSettings, [backupTransaction]);
    const repository = await LedgerRepository.open(root);
    const next = previewAdd(repository.getState(), expense, mutationDependencies);
    await repository.saveTransactions(next.nextTransactions);

    const inspection = await inspectLedgerRoot(root);
    inspection.state!.transactions[0]!.subject = 'changed inspection';
    expect((await inspectLedgerRoot(root)).state!.transactions[0]!.subject).toBe(
      openingTransaction.subject,
    );

    const backup = await inspectLedgerBackup(root, 'transactions');
    expect(backup).toMatchObject({
      kind: 'transactions',
      transactions: 1,
      totals: {income: 5000, expenses: 0, net: 5000},
    });
    backup.state.transactions[0]!.subject = 'changed backup inspection';
    expect(
      (await inspectLedgerBackup(root, 'transactions')).state.transactions[0]!
        .subject,
    ).toBe(backupTransaction.subject);
  });

  test('rejects a ledger whose aggregate arithmetic exceeds the safe integer range', async () => {
    const second: Transaction = {
      ...openingTransaction,
      id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670002',
      amount: 1,
      created_at: '2026-08-01T09:01:00+08:00',
    };
    const root = await createRoot(validSettings, [
      {...openingTransaction, amount: Number.MAX_SAFE_INTEGER},
      second,
    ]);

    const inspection = await inspectLedgerRoot(root);

    expect(inspection.state).toBeNull();
    expect(inspection.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'transactions',
          field: 'amount',
        }),
      ]),
    );
    await expect(LedgerRepository.open(root)).rejects.toBeInstanceOf(
      LedgerValidationError,
    );
  });

  test('reports aggregate overflow independently when settings JSON is invalid', async () => {
    const second: Transaction = {
      ...openingTransaction,
      id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670002',
      amount: 1,
      created_at: '2026-08-01T09:01:00+08:00',
    };
    const root = await createRoot(validSettings, [
      {...openingTransaction, amount: Number.MAX_SAFE_INTEGER},
      second,
    ]);
    const paths = ledgerPaths(root);
    const settingsText = '{"invalid settings"';
    const transactionsText = await readUtf8(paths.transactions);
    await fs.writeFile(paths.settings, settingsText);

    const inspection = await inspectLedgerRoot(root);

    expect(inspection.state).toBeNull();
    expect(inspection.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: 'settings', field: 'json'}),
        expect.objectContaining({source: 'transactions', field: 'amount'}),
      ]),
    );
    expect(await readUtf8(paths.settings)).toBe(settingsText);
    expect(await readUtf8(paths.transactions)).toBe(transactionsText);
    expect(await temporaryFiles(root)).toEqual([]);
  });

  test.each([
    {name: 'blank semester', field: 'semester' as const, value: ''},
    {
      name: 'padded semester',
      field: 'semester' as const,
      value: ' 第一學期',
    },
    {name: 'blank category', field: 'category' as const, value: ''},
    {
      name: 'padded category',
      field: 'category' as const,
      value: '教材與影印 ',
    },
    {name: 'blank officer', field: 'handled_by' as const, value: ''},
    {
      name: 'padded officer',
      field: 'handled_by' as const,
      value: ' 我',
    },
  ])(
    'reports $name independently when settings JSON is invalid',
    async ({field, value}) => {
      const root = await createRoot();
      const paths = ledgerPaths(root);
      const settingsText = '{"invalid settings"';
      const transactionsText = serializeTransactionsCsv([
        {...openingTransaction, [field]: value},
      ]);
      await Promise.all([
        fs.writeFile(paths.settings, settingsText),
        fs.writeFile(paths.transactions, transactionsText),
      ]);

      const inspection = await inspectLedgerRoot(root);

      expect(inspection.state).toBeNull();
      expect(inspection.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({source: 'settings', field: 'json'}),
          expect.objectContaining({source: 'transactions', field}),
        ]),
      );
      expect(await readUtf8(paths.settings)).toBe(settingsText);
      expect(await readUtf8(paths.transactions)).toBe(transactionsText);
      expect(await temporaryFiles(root)).toEqual([]);
    },
  );

  test('reports non-missing read failures with safe path and errno provenance', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const denied = Object.assign(new Error('do not expose this detail'), {
      code: 'EACCES',
    });

    let caught: unknown;
    try {
      await LedgerRepository.open(root, {
        fileSystem: fileSystemProxy({
          readFile: async (...args: unknown[]) => {
            if (String(args[0]) === paths.settings) throw denied;
            return (fs.readFile as (...values: unknown[]) => Promise<unknown>)(
              ...args,
            );
          },
        }),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LedgerValidationError);
    const validation = caught as LedgerValidationError;
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'settings',
          field: 'file',
          value: paths.settings,
          message: expect.stringContaining('EACCES'),
        }),
      ]),
    );
    expect(JSON.stringify(validation.issues)).not.toContain(
      'do not expose this detail',
    );
  });
});

describe('validated saves', () => {
  test('detects an externally changed source before backup or replacement', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const repository = await LedgerRepository.open(root);
    const external = serializeTransactionsCsv(
      [{...openingTransaction, note: 'external edit'}],
      validSettings,
    );
    await fs.mkdir(dirname(paths.transactionsBackup), {recursive: true});
    await fs.writeFile(paths.transactionsBackup, 'existing backup\n');
    await fs.writeFile(paths.transactions, external);

    await expect(
      repository.saveTransactions([{...openingTransaction, note: 'repository edit'}]),
    ).rejects.toEqual(new SourceConflictError(paths.transactions));
    expect(await readUtf8(paths.transactions)).toBe(external);
    expect(await readUtf8(paths.transactionsBackup)).toBe('existing backup\n');
  });

  test('blocks a transaction save when settings changed externally', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const repository = await LedgerRepository.open(root);
    const externalSettings = {
      ...structuredClone(validSettings),
      default_officer: '另一位總務',
    };
    const externalSettingsText = serializeSettings(externalSettings);
    const originalTransactionsText = await readUtf8(paths.transactions);
    await fs.mkdir(dirname(paths.settingsBackup), {recursive: true});
    await Promise.all([
      fs.writeFile(paths.settings, externalSettingsText),
      fs.writeFile(paths.settingsBackup, 'existing settings backup\n'),
      fs.writeFile(paths.transactionsBackup, 'existing transactions backup\n'),
    ]);

    await expect(
      repository.saveTransactions([{...openingTransaction, note: 'repository edit'}]),
    ).rejects.toEqual(new SourceConflictError(paths.settings));
    expect(await readUtf8(paths.settings)).toBe(externalSettingsText);
    expect(await readUtf8(paths.transactions)).toBe(originalTransactionsText);
    expect(await readUtf8(paths.settingsBackup)).toBe(
      'existing settings backup\n',
    );
    expect(await readUtf8(paths.transactionsBackup)).toBe(
      'existing transactions backup\n',
    );
  });

  test('blocks a settings save when transactions changed externally', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const repository = await LedgerRepository.open(root);
    const originalSettingsText = await readUtf8(paths.settings);
    const externalTransactionsText = serializeTransactionsCsv(
      [{...openingTransaction, note: 'external edit'}],
      validSettings,
    );
    await fs.mkdir(dirname(paths.settingsBackup), {recursive: true});
    await Promise.all([
      fs.writeFile(paths.transactions, externalTransactionsText),
      fs.writeFile(paths.settingsBackup, 'existing settings backup\n'),
      fs.writeFile(paths.transactionsBackup, 'existing transactions backup\n'),
    ]);

    await expect(
      repository.saveSettings({
        ...structuredClone(validSettings),
        default_officer: '另一位總務',
      }),
    ).rejects.toEqual(new SourceConflictError(paths.transactions));
    expect(await readUtf8(paths.settings)).toBe(originalSettingsText);
    expect(await readUtf8(paths.transactions)).toBe(externalTransactionsText);
    expect(await readUtf8(paths.settingsBackup)).toBe(
      'existing settings backup\n',
    );
    expect(await readUtf8(paths.transactionsBackup)).toBe(
      'existing transactions backup\n',
    );
  });

  test('preserves the target and cleans temporary siblings when target rename fails', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const original = await readUtf8(paths.transactions);
    const existingBackup = Buffer.from([0x81, 0x0a]);
    await fs.mkdir(dirname(paths.transactionsBackup), {recursive: true});
    await fs.writeFile(paths.transactionsBackup, existingBackup);
    const injected = new Error('injected target rename failure');
    let failed = false;
    const dependencies: RepositoryDependencies = {
      createTemporarySuffix: () => `failure-${crypto.randomUUID()}`,
      fileSystem: fileSystemProxy({
        rename: async (from: PathLike, to: PathLike) => {
          if (!failed && String(to) === paths.transactions) {
            failed = true;
            throw injected;
          }
          return fs.rename(from, to);
        },
      }),
    };
    const repository = await LedgerRepository.open(root, dependencies);

    await expect(
      repository.saveTransactions([{...openingTransaction, note: 'next'}]),
    ).rejects.toBe(injected);
    expect(await readUtf8(paths.transactions)).toBe(original);
    expect(await fs.readFile(paths.transactionsBackup)).toEqual(existingBackup);
    expect(await temporaryFiles(root)).toEqual([]);
  });

  test('preserves the target and raw error when target temporary writeFile fails', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const original = await fs.readFile(paths.transactions);
    const existingBackup = Buffer.from([0x82, 0x0a]);
    await fs.mkdir(dirname(paths.transactionsBackup), {recursive: true});
    await fs.writeFile(paths.transactionsBackup, existingBackup);
    const injected = new Error('injected target temporary write failure');
    let failed = false;
    const wrappedOpen = async (...args: unknown[]): Promise<FileHandle> => {
      const handle = await (fs.open as (...values: unknown[]) => Promise<FileHandle>)(
        ...args,
      );
      const path = String(args[0]);
      const isTargetTemporary =
        dirname(path) === dirname(paths.transactions) &&
        basename(path).startsWith('.transactions.csv.') &&
        path.endsWith('.tmp');
      if (!isTargetTemporary) return handle;

      return new Proxy(handle, {
        get(target, property) {
          if (property === 'writeFile') {
            return async () => {
              failed = true;
              throw injected;
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    const repository = await LedgerRepository.open(root, {
      createTemporarySuffix: () => `write-failure-${crypto.randomUUID()}`,
      fileSystem: fileSystemProxy({open: wrappedOpen}),
    });

    await expect(
      repository.saveTransactions([{...openingTransaction, note: 'next'}]),
    ).rejects.toBe(injected);
    expect(failed).toBe(true);
    expect(await fs.readFile(paths.transactions)).toEqual(original);
    expect(await fs.readFile(paths.transactionsBackup)).toEqual(existingBackup);
    expect(await temporaryFiles(root)).toEqual([]);
  });

  test('detects a companion edit after staging and before the first commit rename', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const repositoryState = await LedgerRepository.open(root);
    const originalTarget = await fs.readFile(paths.transactions);
    const existingBackup = Buffer.from('existing backup\n');
    const externalSettings = {
      ...structuredClone(validSettings),
      default_officer: '另一位總務',
    };
    const externalSettingsText = serializeSettings(externalSettings);
    await fs.mkdir(dirname(paths.transactionsBackup), {recursive: true});
    await fs.writeFile(paths.transactionsBackup, existingBackup);
    let changed = false;
    const wrappedOpen = async (...args: unknown[]): Promise<FileHandle> => {
      const handle = await (fs.open as (...values: unknown[]) => Promise<FileHandle>)(
        ...args,
      );
      const path = String(args[0]);
      if (
        dirname(path) !== dirname(paths.transactions) ||
        !basename(path).startsWith('.transactions.csv.') ||
        !path.endsWith('.tmp')
      ) {
        return handle;
      }
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'sync') {
            return async () => {
              await target.sync();
              if (!changed) {
                changed = true;
                await fs.writeFile(paths.settings, externalSettingsText);
              }
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    const repository = await LedgerRepository.open(root, {
      fileSystem: fileSystemProxy({open: wrappedOpen}),
    });

    await expect(
      repository.saveTransactions([
        {...repositoryState.getState().transactions[0]!, note: 'next'},
      ]),
    ).rejects.toEqual(new SourceConflictError(paths.settings));
    expect(changed).toBe(true);
    expect(await readUtf8(paths.settings)).toBe(externalSettingsText);
    expect(await fs.readFile(paths.transactions)).toEqual(originalTarget);
    expect(await fs.readFile(paths.transactionsBackup)).toEqual(existingBackup);
    expect(await temporaryFiles(root)).toEqual([]);
  });

  test('rolls target and backup back when companion changes after target rename', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const originalTarget = await fs.readFile(paths.transactions);
    const existingBackup = Buffer.from([0x83, 0x0a]);
    const externalSettings = {
      ...structuredClone(validSettings),
      default_officer: '另一位總務',
    };
    const externalSettingsText = serializeSettings(externalSettings);
    await fs.mkdir(dirname(paths.transactionsBackup), {recursive: true});
    await fs.writeFile(paths.transactionsBackup, existingBackup);
    let changed = false;
    const repository = await LedgerRepository.open(root, {
      fileSystem: fileSystemProxy({
        rename: async (from: PathLike, to: PathLike) => {
          await fs.rename(from, to);
          if (!changed && String(to) === paths.transactions) {
            changed = true;
            await fs.writeFile(paths.settings, externalSettingsText);
          }
        },
      }),
    });

    await expect(
      repository.saveTransactions([{...openingTransaction, note: 'next'}]),
    ).rejects.toEqual(new SourceConflictError(paths.settings));
    expect(await readUtf8(paths.settings)).toBe(externalSettingsText);
    expect(await fs.readFile(paths.transactions)).toEqual(originalTarget);
    expect(await fs.readFile(paths.transactionsBackup)).toEqual(existingBackup);
    expect(await temporaryFiles(root)).toEqual([]);
  });

  test('rolls both paths back when backup rename takes effect and rejects', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const originalTarget = await fs.readFile(paths.transactions);
    const existingBackup = Buffer.from([0x84, 0x0a]);
    await fs.mkdir(dirname(paths.transactionsBackup), {recursive: true});
    await fs.writeFile(paths.transactionsBackup, existingBackup);
    const injected = new Error('injected post-backup-rename failure');
    let failed = false;
    const repository = await LedgerRepository.open(root, {
      fileSystem: fileSystemProxy({
        rename: async (from: PathLike, to: PathLike) => {
          await fs.rename(from, to);
          if (!failed && String(to) === paths.transactionsBackup) {
            failed = true;
            throw injected;
          }
        },
      }),
    });

    await expect(
      repository.saveTransactions([{...openingTransaction, note: 'next'}]),
    ).rejects.toBe(injected);
    expect(await fs.readFile(paths.transactions)).toEqual(originalTarget);
    expect(await fs.readFile(paths.transactionsBackup)).toEqual(existingBackup);
    expect(await temporaryFiles(root)).toEqual([]);
  });

  test('preserves an external selected-source edit detected after its rename', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const existingBackup = Buffer.from([0x85, 0x0a]);
    const external = Buffer.from(
      serializeTransactionsCsv(
        [{...openingTransaction, note: 'external after rename'}],
        validSettings,
      ),
    );
    await fs.mkdir(dirname(paths.transactionsBackup), {recursive: true});
    await fs.writeFile(paths.transactionsBackup, existingBackup);
    let changed = false;
    const wrappedOpen = async (...args: unknown[]): Promise<FileHandle> => {
      const handle = await (fs.open as (...values: unknown[]) => Promise<FileHandle>)(
        ...args,
      );
      if (String(args[0]) !== dirname(paths.transactionsBackup)) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'sync') {
            return async () => {
              await target.sync();
              if (!changed) {
                changed = true;
                await fs.writeFile(paths.transactions, external);
              }
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    const repository = await LedgerRepository.open(root, {
      fileSystem: fileSystemProxy({open: wrappedOpen}),
    });

    await expect(
      repository.saveTransactions([{...openingTransaction, note: 'next'}]),
    ).rejects.toEqual(new SourceConflictError(paths.transactions));
    expect(changed).toBe(true);
    expect(await fs.readFile(paths.transactions)).toEqual(external);
    expect(await fs.readFile(paths.transactionsBackup)).toEqual(existingBackup);
    expect(repository.getState().transactions).toEqual([openingTransaction]);
    expect(await temporaryFiles(root)).toEqual([]);
  });

  test('preserves an external backup edit detected during save rollback', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const originalTarget = await fs.readFile(paths.transactions);
    const existingBackup = Buffer.from([0x86, 0x0a]);
    const externalBackup = Buffer.from([0x87, 0x0a]);
    await fs.mkdir(dirname(paths.transactionsBackup), {recursive: true});
    await fs.writeFile(paths.transactionsBackup, existingBackup);
    const injected = new Error('injected failure after external backup edit');
    let changed = false;
    const wrappedOpen = async (...args: unknown[]): Promise<FileHandle> => {
      const handle = await (fs.open as (...values: unknown[]) => Promise<FileHandle>)(
        ...args,
      );
      if (String(args[0]) !== dirname(paths.transactionsBackup)) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'sync') {
            return async () => {
              await target.sync();
              if (!changed) {
                changed = true;
                await fs.writeFile(paths.transactionsBackup, externalBackup);
                throw injected;
              }
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    const repository = await LedgerRepository.open(root, {
      fileSystem: fileSystemProxy({open: wrappedOpen}),
    });

    let caught: unknown;
    try {
      await repository.saveTransactions([
        {...openingTransaction, note: 'repository edit'},
      ]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual(
      expect.arrayContaining([
        injected,
        new SourceConflictError(paths.transactionsBackup),
      ]),
    );
    expect(await fs.readFile(paths.transactions)).toEqual(originalTarget);
    expect(await fs.readFile(paths.transactionsBackup)).toEqual(externalBackup);
    expect(await temporaryFiles(root)).toEqual([]);
  });

  test('removes a newly created backup when target directory sync fails', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const originalTarget = await fs.readFile(paths.transactions);
    const injected = new Error('injected target directory sync failure');
    let failed = false;
    const wrappedOpen = async (...args: unknown[]): Promise<FileHandle> => {
      const handle = await (fs.open as (...values: unknown[]) => Promise<FileHandle>)(
        ...args,
      );
      if (String(args[0]) !== dirname(paths.transactions)) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'sync') {
            return async () => {
              if (!failed) {
                failed = true;
                throw injected;
              }
              return target.sync();
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    const repository = await LedgerRepository.open(root, {
      fileSystem: fileSystemProxy({open: wrappedOpen}),
    });

    await expect(
      repository.saveTransactions([{...openingTransaction, note: 'next'}]),
    ).rejects.toBe(injected);
    expect(await fs.readFile(paths.transactions)).toEqual(originalTarget);
    expect(await pathExists(paths.transactionsBackup)).toBe(false);
    expect(await temporaryFiles(root)).toEqual([]);
  });

  test('hashes raw source bytes so distinct invalid UTF-8 is a conflict', async () => {
    const root = await createRoot(validSettings, [
      {...openingTransaction, note: '\ufffd'},
    ]);
    const paths = ledgerPaths(root);
    const sourceA = malformedReplacementBytes(
      await readUtf8(paths.transactions),
      [0xc0, 0xaf],
    );
    await fs.writeFile(paths.transactions, sourceA);
    const repository = await LedgerRepository.open(root);
    const sourceB = Buffer.from(sourceA);
    const invalidSequence = sourceB.indexOf(Buffer.from([0xc0, 0xaf]));
    expect(invalidSequence).toBeGreaterThanOrEqual(0);
    sourceB[invalidSequence] = 0xc1;
    await fs.writeFile(paths.transactions, sourceB);

    await expect(
      repository.saveTransactions([{...openingTransaction, note: 'next'}]),
    ).rejects.toEqual(new SourceConflictError(paths.transactions));
    expect(await fs.readFile(paths.transactions)).toEqual(sourceB);
  });

  test('backs up the exact raw source bytes on a successful save', async () => {
    const root = await createRoot(validSettings, [
      {...openingTransaction, note: '\ufffd'},
    ]);
    const paths = ledgerPaths(root);
    const source = malformedReplacementBytes(
      await readUtf8(paths.transactions),
      0x80,
    );
    await fs.writeFile(paths.transactions, source);
    const repository = await LedgerRepository.open(root);

    await repository.saveTransactions([{...openingTransaction, note: 'next'}]);

    expect(await fs.readFile(paths.transactionsBackup)).toEqual(source);
  });

  test('preserves a colliding temporary file that this save does not own', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const suffix = 'collision';
    const collision = join(
      dirname(paths.transactionsBackup),
      `.transactions.csv.${suffix}.tmp`,
    );
    const contents = Buffer.from('pre-existing temporary\n');
    await fs.mkdir(dirname(collision), {recursive: true});
    await fs.writeFile(collision, contents);
    const repository = await LedgerRepository.open(root, {
      createTemporarySuffix: () => suffix,
    });

    await expect(
      repository.saveTransactions([{...openingTransaction, note: 'next'}]),
    ).rejects.toMatchObject({code: 'EEXIST'});
    expect(await fs.readFile(collision)).toEqual(contents);
  });

  test('validates the full proposed pair before changing sources or backups', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const repository = await LedgerRepository.open(root);
    const nextSettings = structuredClone(validSettings);
    nextSettings.categories = nextSettings.categories.filter(
      ({value}) => value !== openingTransaction.category,
    );
    await fs.mkdir(dirname(paths.settingsBackup), {recursive: true});
    await fs.writeFile(paths.settingsBackup, 'existing settings backup\n');
    const before = await Promise.all([
      readUtf8(paths.settings),
      readUtf8(paths.transactions),
      readUtf8(paths.settingsBackup),
    ]);

    await expect(repository.saveSettings(nextSettings)).rejects.toBeInstanceOf(
      LedgerValidationError,
    );
    expect(
      await Promise.all([
        readUtf8(paths.settings),
        readUtf8(paths.transactions),
        readUtf8(paths.settingsBackup),
      ]),
    ).toEqual(before);
  });

  test('syncs both temporary files and their parent directories around rename', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const events: string[] = [];
    const instrumentedOpen = async (...args: unknown[]): Promise<FileHandle> => {
      const handle = await (fs.open as (...openArgs: unknown[]) => Promise<FileHandle>)(
        ...args,
      );
      const path = String(args[0]);
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'writeFile') {
            return async (...writeArgs: unknown[]) => {
              events.push(`write:${path}`);
              return (target.writeFile as (...values: unknown[]) => Promise<void>)(
                ...writeArgs,
              );
            };
          }
          if (property === 'sync') {
            return async () => {
              events.push(`sync:${path}`);
              return target.sync();
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    const dependencies: RepositoryDependencies = {
      createTemporarySuffix: (() => {
        let next = 0;
        return () => `observed-${next++}`;
      })(),
      fileSystem: fileSystemProxy({
        open: instrumentedOpen,
        rename: async (from: PathLike, to: PathLike) => {
          events.push(`rename:${String(from)}->${String(to)}`);
          return fs.rename(from, to);
        },
      }),
    };
    const repository = await LedgerRepository.open(root, dependencies);

    await repository.saveTransactions([{...openingTransaction, note: 'next'}]);

    const temporaryWrites = events.filter(
      (event) => event.startsWith('write:') && event.endsWith('.tmp'),
    );
    expect(temporaryWrites).toHaveLength(2);
    for (const write of temporaryWrites) {
      expect(events).toContain(write.replace('write:', 'sync:'));
    }
    expect(events).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          new RegExp(`rename:.*->${paths.transactionsBackup.replaceAll('.', '\\.')}$`),
        ),
        expect.stringMatching(
          new RegExp(`rename:.*->${paths.transactions.replaceAll('.', '\\.')}$`),
        ),
        `sync:${dirname(paths.transactionsBackup)}`,
        `sync:${dirname(paths.transactions)}`,
      ]),
    );
    const backupRename = events.findIndex((event) =>
      event.endsWith(`->${paths.transactionsBackup}`),
    );
    const backupDirectorySync = events.indexOf(
      `sync:${dirname(paths.transactionsBackup)}`,
    );
    const targetRename = events.findIndex((event) =>
      event.endsWith(`->${paths.transactions}`),
    );
    const targetDirectorySync = events.indexOf(
      `sync:${dirname(paths.transactions)}`,
    );
    expect(backupRename).toBeLessThan(backupDirectorySync);
    expect(backupDirectorySync).toBeLessThan(targetRename);
    expect(targetRename).toBeLessThan(targetDirectorySync);
  });

  test('syncs each newly created backup directory entry before any rename', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const events: string[] = [];
    const wrappedOpen = async (...args: unknown[]): Promise<FileHandle> => {
      const handle = await (fs.open as (...values: unknown[]) => Promise<FileHandle>)(
        ...args,
      );
      const path = String(args[0]);
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'sync') {
            return async () => {
              events.push(`sync:${path}`);
              return target.sync();
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    const repository = await LedgerRepository.open(root, {
      fileSystem: fileSystemProxy({
        mkdir: async (...args: unknown[]) => {
          events.push(`mkdir:${String(args[0])}`);
          return (fs.mkdir as (...values: unknown[]) => Promise<unknown>)(
            ...args,
          );
        },
        open: wrappedOpen,
        rename: async (from: PathLike, to: PathLike) => {
          events.push(`rename:${String(to)}`);
          return fs.rename(from, to);
        },
      }),
    });

    await repository.saveTransactions([{...openingTransaction, note: 'next'}]);

    const local = join(root, '.local');
    const backups = dirname(paths.transactionsBackup);
    const firstRename = events.findIndex((event) => event.startsWith('rename:'));
    expect(events.indexOf(`mkdir:${local}`)).toBeLessThan(
      events.indexOf(`sync:${root}`),
    );
    expect(events.indexOf(`sync:${root}`)).toBeLessThan(
      events.indexOf(`mkdir:${backups}`),
    );
    expect(events.indexOf(`mkdir:${backups}`)).toBeLessThan(
      events.indexOf(`sync:${local}`),
    );
    expect(events.indexOf(`sync:${local}`)).toBeLessThan(firstRename);
  });

  test('saves canonical settings and exposes the prior pair through repository backup inspection', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const originalSettingsText = await readUtf8(paths.settings);
    const repository = await LedgerRepository.open(root);
    const nextSettings = {
      ...structuredClone(validSettings),
      default_officer: '另一位總務',
    };

    await repository.saveSettings(nextSettings);

    expect(await readUtf8(paths.settings)).toBe(serializeSettings(nextSettings));
    expect(await readUtf8(paths.settingsBackup)).toBe(originalSettingsText);
    const backup = await repository.inspectBackup('settings');
    expect(backup.kind).toBe('settings');
    expect(backup.state).toEqual({
      settings: validSettings,
      transactions: [openingTransaction],
    });
  });
});

describe('backup restore', () => {
  async function rootWithTransactionBackup(): Promise<{
    root: string;
    current: string;
    backup: string;
  }> {
    const root = await createRoot();
    const repository = await LedgerRepository.open(root);
    const next = previewAdd(repository.getState(), expense, mutationDependencies);
    await repository.saveTransactions(next.nextTransactions);
    const paths = ledgerPaths(root);
    return {
      root,
      current: await readUtf8(paths.transactions),
      backup: await readUtf8(paths.transactionsBackup),
    };
  }

  function externalTransactionBytes(note: string): Buffer {
    return Buffer.from(
      serializeTransactionsCsv([{...openingTransaction, note}], validSettings),
    );
  }

  test('swaps current and backup, and a second restore swaps them back', async () => {
    const {root, current, backup} = await rootWithTransactionBackup();
    const paths = ledgerPaths(root);
    const repository = await LedgerRepository.open(root);

    await repository.restore('transactions');
    expect(await readUtf8(paths.transactions)).toBe(backup);
    expect(await readUtf8(paths.transactionsBackup)).toBe(current);
    expect(repository.getState().transactions).toHaveLength(1);

    await repository.restore('transactions');
    expect(await readUtf8(paths.transactions)).toBe(current);
    expect(await readUtf8(paths.transactionsBackup)).toBe(backup);
    expect(repository.getState().transactions).toHaveLength(2);
  });

  test('throws MissingBackupError with the exact selected backup path', async () => {
    const root = await createRoot();
    const path = ledgerPaths(root).settingsBackup;

    await expect(inspectLedgerBackup(root, 'settings')).rejects.toEqual(
      new MissingBackupError(path),
    );
    await expect(restoreLedgerBackup(root, 'settings')).rejects.toEqual(
      new MissingBackupError(path),
    );
  });

  test('binds a relative restore root before awaited file operations', async () => {
    const container = await fs.mkdtemp(join(tmpdir(), 'class-fund-relative-'));
    roots.push(container);
    const firstParent = join(container, 'first');
    const secondParent = join(container, 'second');
    const firstRoot = join(firstParent, 'ledger');
    const secondRoot = join(secondParent, 'ledger');
    const firstPaths = ledgerPaths(firstRoot);
    const secondPaths = ledgerPaths(secondRoot);
    const firstCurrent = externalTransactionBytes('first current');
    const firstBackup = externalTransactionBytes('first backup');
    const secondCurrent = externalTransactionBytes('second current');
    const secondBackup = externalTransactionBytes('second backup');
    const settings = Buffer.from(serializeSettings(validSettings));
    await Promise.all([
      fs.mkdir(dirname(firstPaths.transactions), {recursive: true}),
      fs.mkdir(dirname(firstPaths.transactionsBackup), {recursive: true}),
      fs.mkdir(dirname(secondPaths.transactions), {recursive: true}),
      fs.mkdir(dirname(secondPaths.transactionsBackup), {recursive: true}),
    ]);
    await Promise.all([
      fs.writeFile(firstPaths.settings, settings),
      fs.writeFile(firstPaths.transactions, firstCurrent),
      fs.writeFile(firstPaths.transactionsBackup, firstBackup),
      fs.writeFile(secondPaths.settings, settings),
      fs.writeFile(secondPaths.transactions, secondCurrent),
      fs.writeFile(secondPaths.transactionsBackup, secondBackup),
    ]);
    const originalCwd = process.cwd();
    let changed = false;
    let restored: Awaited<ReturnType<typeof restoreLedgerBackup>>;
    const wrappedReadFile = async (...args: unknown[]): Promise<Buffer> => {
      const bytes = await (fs.readFile as (
        ...values: unknown[]
      ) => Promise<Buffer>)(...args);
      if (!changed && String(args[0]) === firstPaths.transactions) {
        changed = true;
        process.chdir(secondParent);
      }
      return bytes;
    };

    try {
      process.chdir(firstParent);
      restored = await restoreLedgerBackup('ledger', 'transactions', {
        fileSystem: fileSystemProxy({readFile: wrappedReadFile}),
      });
    } finally {
      process.chdir(originalCwd);
    }

    expect(changed).toBe(true);
    expect(restored.root).toBe(firstRoot);
    expect(restored.state?.transactions[0]?.note).toBe('first backup');
    expect(await fs.readFile(firstPaths.transactions)).toEqual(firstBackup);
    expect(await fs.readFile(firstPaths.transactionsBackup)).toEqual(firstCurrent);
    expect(await fs.readFile(secondPaths.transactions)).toEqual(secondCurrent);
    expect(await fs.readFile(secondPaths.transactionsBackup)).toEqual(secondBackup);
    expect(await temporaryFiles(firstRoot)).toEqual([]);
    expect(await temporaryFiles(secondRoot)).toEqual([]);
  });

  test.each(['current', 'backup'] as const)(
    'rejects and preserves an external selected-%s edit during staging',
    async (edited) => {
      const {root} = await rootWithTransactionBackup();
      const paths = ledgerPaths(root);
      const current = await fs.readFile(paths.transactions);
      const backup = await fs.readFile(paths.transactionsBackup);
      const external = externalTransactionBytes(`external ${edited} staging`);
      const editedPath =
        edited === 'current' ? paths.transactions : paths.transactionsBackup;
      let changed = false;
      const rename = vi.fn(fs.rename);
      const wrappedOpen = async (...args: unknown[]): Promise<FileHandle> => {
        const handle = await (fs.open as (...values: unknown[]) => Promise<FileHandle>)(
          ...args,
        );
        const path = String(args[0]);
        const isBackupTemporary =
          dirname(path) === dirname(paths.transactionsBackup) &&
          basename(path).startsWith('.transactions.csv.') &&
          path.endsWith('.tmp');
        if (!isBackupTemporary) return handle;
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'sync') {
              return async () => {
                await target.sync();
                if (!changed) {
                  changed = true;
                  await fs.writeFile(editedPath, external);
                }
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      };

      await expect(
        restoreLedgerBackup(root, 'transactions', {
          fileSystem: fileSystemProxy({open: wrappedOpen, rename}),
        }),
      ).rejects.toEqual(new SourceConflictError(editedPath));
      expect(changed).toBe(true);
      expect(rename).not.toHaveBeenCalled();
      expect(await fs.readFile(paths.transactions)).toEqual(
        edited === 'current' ? external : current,
      );
      expect(await fs.readFile(paths.transactionsBackup)).toEqual(
        edited === 'backup' ? external : backup,
      );
      expect(await temporaryFiles(root)).toEqual([]);
    },
  );

  test('rejects and preserves an external companion edit during staging', async () => {
    const {root} = await rootWithTransactionBackup();
    const paths = ledgerPaths(root);
    const current = await fs.readFile(paths.transactions);
    const backup = await fs.readFile(paths.transactionsBackup);
    const externalSettings = serializeSettings({
      ...structuredClone(validSettings),
      categories: [
        ...validSettings.categories,
        {value: '校外教學', status: 'active'},
      ],
    });
    let changed = false;
    const rename = vi.fn(fs.rename);
    const wrappedOpen = async (...args: unknown[]): Promise<FileHandle> => {
      const handle = await (fs.open as (...values: unknown[]) => Promise<FileHandle>)(
        ...args,
      );
      const path = String(args[0]);
      const isBackupTemporary =
        dirname(path) === dirname(paths.transactionsBackup) &&
        basename(path).startsWith('.transactions.csv.') &&
        path.endsWith('.tmp');
      if (!isBackupTemporary) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'sync') {
            return async () => {
              await target.sync();
              if (!changed) {
                changed = true;
                await fs.writeFile(paths.settings, externalSettings);
              }
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };

    await expect(
      restoreLedgerBackup(root, 'transactions', {
        fileSystem: fileSystemProxy({open: wrappedOpen, rename}),
      }),
    ).rejects.toEqual(new SourceConflictError(paths.settings));
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readFile(paths.settings)).toEqual(
      Buffer.from(externalSettings),
    );
    expect(await fs.readFile(paths.transactions)).toEqual(current);
    expect(await fs.readFile(paths.transactionsBackup)).toEqual(backup);
    expect(await temporaryFiles(root)).toEqual([]);
  });

  test.each(['current', 'backup'] as const)(
    'rejects and preserves an external selected-%s edit between swap renames',
    async (edited) => {
      const {root} = await rootWithTransactionBackup();
      const paths = ledgerPaths(root);
      const current = await fs.readFile(paths.transactions);
      const backup = await fs.readFile(paths.transactionsBackup);
      const external = externalTransactionBytes(`external ${edited} between`);
      const editedPath =
        edited === 'current' ? paths.transactions : paths.transactionsBackup;
      let changed = false;

      await expect(
        restoreLedgerBackup(root, 'transactions', {
          fileSystem: fileSystemProxy({
            rename: async (from: PathLike, to: PathLike) => {
              await fs.rename(from, to);
              if (!changed && String(to) === paths.transactions) {
                changed = true;
                await fs.writeFile(editedPath, external);
              }
            },
          }),
        }),
      ).rejects.toEqual(new SourceConflictError(editedPath));
      expect(changed).toBe(true);
      expect(await fs.readFile(paths.transactions)).toEqual(
        edited === 'current' ? external : current,
      );
      expect(await fs.readFile(paths.transactionsBackup)).toEqual(
        edited === 'backup' ? external : backup,
      );
      expect(await temporaryFiles(root)).toEqual([]);
    },
  );

  test.each(['current', 'backup'] as const)(
    'rejects and preserves an external selected-%s edit after both swap renames',
    async (edited) => {
      const {root} = await rootWithTransactionBackup();
      const paths = ledgerPaths(root);
      const current = await fs.readFile(paths.transactions);
      const backup = await fs.readFile(paths.transactionsBackup);
      const external = externalTransactionBytes(`external ${edited} after`);
      const editedPath =
        edited === 'current' ? paths.transactions : paths.transactionsBackup;
      let changed = false;

      await expect(
        restoreLedgerBackup(root, 'transactions', {
          fileSystem: fileSystemProxy({
            rename: async (from: PathLike, to: PathLike) => {
              await fs.rename(from, to);
              if (!changed && String(to) === paths.transactionsBackup) {
                changed = true;
                await fs.writeFile(editedPath, external);
              }
            },
          }),
        }),
      ).rejects.toEqual(new SourceConflictError(editedPath));
      expect(changed).toBe(true);
      expect(await fs.readFile(paths.transactions)).toEqual(
        edited === 'current' ? external : current,
      );
      expect(await fs.readFile(paths.transactionsBackup)).toEqual(
        edited === 'backup' ? external : backup,
      );
      expect(await temporaryFiles(root)).toEqual([]);
    },
  );

  test('inspects and restores a backup when the selected current source is invalid', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const validTransactions = await readUtf8(paths.transactions);
    await fs.mkdir(dirname(paths.transactionsBackup), {recursive: true});
    await fs.writeFile(paths.transactionsBackup, validTransactions);
    await fs.writeFile(paths.transactions, 'invalid current source\n');

    await expect(LedgerRepository.open(root)).rejects.toBeInstanceOf(
      LedgerValidationError,
    );
    await expect(inspectLedgerBackup(root, 'transactions')).resolves.toMatchObject({
      kind: 'transactions',
      transactions: 1,
      totals: {income: 500, expenses: 0, net: 500},
    });
    const restored = await restoreLedgerBackup(root, 'transactions');
    expect(restored.state?.transactions).toEqual([openingTransaction]);
    expect(await readUtf8(paths.transactions)).toBe(validTransactions);
    expect(await readUtf8(paths.transactionsBackup)).toBe(
      'invalid current source\n',
    );
  });

  test('swaps an invalid current source without normalizing its raw bytes', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    const validTransactions = await fs.readFile(paths.transactions);
    const invalidBytes = Buffer.from([0x80, 0x0a]);
    await fs.mkdir(dirname(paths.transactionsBackup), {recursive: true});
    await fs.writeFile(paths.transactionsBackup, validTransactions);
    await fs.writeFile(paths.transactions, invalidBytes);

    await restoreLedgerBackup(root, 'transactions');

    expect(await fs.readFile(paths.transactions)).toEqual(validTransactions);
    expect(await fs.readFile(paths.transactionsBackup)).toEqual(invalidBytes);
  });

  test('rejects an invalid selected backup and companion pair before any write', async () => {
    const root = await createRoot();
    const paths = ledgerPaths(root);
    await fs.mkdir(dirname(paths.transactionsBackup), {recursive: true});
    await fs.writeFile(paths.transactionsBackup, 'invalid backup\n');
    const before = await Promise.all([
      readUtf8(paths.transactions),
      readUtf8(paths.transactionsBackup),
    ]);
    const rename = vi.fn(fs.rename);
    const open = vi.fn(fs.open);

    await expect(
      restoreLedgerBackup(root, 'transactions', {
        fileSystem: fileSystemProxy({rename, open}),
      }),
    ).rejects.toBeInstanceOf(LedgerValidationError);
    expect(rename).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(
      await Promise.all([
        readUtf8(paths.transactions),
        readUtf8(paths.transactionsBackup),
      ]),
    ).toEqual(before);
  });

  test.each(['current rename', 'backup rename', 'directory sync'] as const)(
    'rolls back both files and cleans temporary siblings after a failed %s',
    async (stage) => {
      const {root, current, backup} = await rootWithTransactionBackup();
      const paths = ledgerPaths(root);
      const injected = new Error(`injected ${stage}`);
      let failed = false;
      const wrappedOpen = async (...args: unknown[]): Promise<FileHandle> => {
        const handle = await (fs.open as (...values: unknown[]) => Promise<FileHandle>)(
          ...args,
        );
        const path = String(args[0]);
        if (stage !== 'directory sync' || path !== dirname(paths.transactions)) {
          return handle;
        }
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'sync') {
              return async () => {
                if (!failed) {
                  failed = true;
                  throw injected;
                }
                return target.sync();
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      };
      const dependencies: RepositoryDependencies = {
        createTemporarySuffix: () => crypto.randomUUID(),
        fileSystem: fileSystemProxy({
          open: wrappedOpen,
          rename: async (from: PathLike, to: PathLike) => {
            const shouldFail =
              !failed &&
              ((stage === 'current rename' && String(to) === paths.transactions) ||
                (stage === 'backup rename' &&
                  String(to) === paths.transactionsBackup));
            if (shouldFail) {
              failed = true;
              throw injected;
            }
            return fs.rename(from, to);
          },
        }),
      };

      await expect(
        restoreLedgerBackup(root, 'transactions', dependencies),
      ).rejects.toBe(injected);
      expect(await readUtf8(paths.transactions)).toBe(current);
      expect(await readUtf8(paths.transactionsBackup)).toBe(backup);
      expect(await temporaryFiles(root)).toEqual([]);
    },
  );

  test.each(['current', 'backup'] as const)(
    'rolls back when the %s rename takes effect and then rejects',
    async (stage) => {
      const {root} = await rootWithTransactionBackup();
      const paths = ledgerPaths(root);
      const current = await fs.readFile(paths.transactions);
      const backup = await fs.readFile(paths.transactionsBackup);
      const injected = new Error(`injected post-${stage}-rename failure`);
      let failed = false;
      const target =
        stage === 'current' ? paths.transactions : paths.transactionsBackup;
      const dependencies: RepositoryDependencies = {
        createTemporarySuffix: () => crypto.randomUUID(),
        fileSystem: fileSystemProxy({
          rename: async (from: PathLike, to: PathLike) => {
            await fs.rename(from, to);
            if (!failed && String(to) === target) {
              failed = true;
              throw injected;
            }
          },
        }),
      };

      await expect(
        restoreLedgerBackup(root, 'transactions', dependencies),
      ).rejects.toBe(injected);
      expect(await fs.readFile(paths.transactions)).toEqual(current);
      expect(await fs.readFile(paths.transactionsBackup)).toEqual(backup);
      expect(await temporaryFiles(root)).toEqual([]);
    },
  );

  test('attempts current rollback even when backup rollback fails', async () => {
    const {root} = await rootWithTransactionBackup();
    const paths = ledgerPaths(root);
    const syncFailure = new Error('injected forward directory sync failure');
    const rollbackFailure = new Error('injected backup rollback failure');
    let forwardSyncFailed = false;
    let currentRenames = 0;
    let backupRenames = 0;
    const wrappedOpen = async (...args: unknown[]): Promise<FileHandle> => {
      const handle = await (fs.open as (...values: unknown[]) => Promise<FileHandle>)(
        ...args,
      );
      if (String(args[0]) !== dirname(paths.transactions)) return handle;
      return new Proxy(handle, {
        get(target, property) {
          if (property === 'sync') {
            return async () => {
              if (!forwardSyncFailed) {
                forwardSyncFailed = true;
                throw syncFailure;
              }
              return target.sync();
            };
          }
          const value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };

    await expect(
      restoreLedgerBackup(root, 'transactions', {
        createTemporarySuffix: () => crypto.randomUUID(),
        fileSystem: fileSystemProxy({
          open: wrappedOpen,
          rename: async (from: PathLike, to: PathLike) => {
            if (String(to) === paths.transactions) currentRenames += 1;
            if (String(to) === paths.transactionsBackup) {
              backupRenames += 1;
              if (forwardSyncFailed && backupRenames === 2) {
                throw rollbackFailure;
              }
            }
            return fs.rename(from, to);
          },
        }),
      }),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(currentRenames).toBe(2);
    expect(backupRenames).toBe(2);
  });
});
