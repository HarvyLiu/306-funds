import {createHash, randomUUID} from 'node:crypto';
import * as nodeFileSystem from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';

import {parse} from 'csv-parse/sync';

import {calculateTotals} from '../calculations.js';
import {parseTransactionsCsv, serializeTransactionsCsv} from '../csv.js';
import {
  LedgerValidationError,
  MissingBackupError,
  SourceConflictError,
} from '../errors.js';
import {
  parseSettingsText,
  serializeSettings,
} from '../settings.js';
import type {
  LedgerIssue,
  LedgerSettings,
  LedgerState,
  Totals,
  Transaction,
} from '../types.js';

export type SourceKind = 'settings' | 'transactions';

export interface RepositoryDependencies {
  fileSystem?: typeof import('node:fs/promises');
  createTemporarySuffix?(): string;
}

export interface LedgerInspection {
  root: string;
  settingsText: string | null;
  transactionsText: string | null;
  issues: LedgerIssue[];
  state: LedgerState | null;
}

export interface BackupInspection {
  kind: SourceKind;
  transactions: number;
  totals: Totals;
  state: LedgerState;
}

interface ResolvedDependencies {
  fileSystem: typeof import('node:fs/promises');
  createTemporarySuffix(): string;
}

interface ValidPair {
  settingsText: string;
  transactionsText: string;
  state: LedgerState;
  totals: Totals;
}

interface ReadResult {
  bytes: Buffer | null;
  text: string | null;
  issue: LedgerIssue | null;
}

interface InternalInspection extends LedgerInspection {
  sourceBytes: Record<SourceKind, Buffer | null>;
}

type FilePayload = string | Uint8Array;

type ReferenceField = 'semester' | 'category' | 'handled_by';

function referenceOptions(
  records: readonly Record<string, unknown>[],
  field: ReferenceField,
): LedgerSettings['semesters'] {
  const values = new Set<string>();
  for (const record of records) {
    const value = record[field];
    if (
      typeof value === 'string' &&
      value.length > 0 &&
      value.trim() === value
    ) {
      values.add(value);
    }
  }
  return [...values].map((value) => ({value, status: 'active'}));
}

function independentTransactionSettings(text: string): LedgerSettings {
  let records: Record<string, unknown>[] = [];
  try {
    records = parse<Record<string, unknown>>(text, {
      bom: true,
      columns: true,
      relax_column_count: false,
      skip_empty_lines: true,
    });
  } catch {
    // The canonical parser below reports structural CSV failures.
  }

  const semesters = referenceOptions(records, 'semester');
  const categories = referenceOptions(records, 'category');
  const officers = referenceOptions(records, 'handled_by');
  return {
    schema_version: 1,
    currency: 'TWD',
    active_semester: semesters[0]?.value ?? '',
    default_officer: officers[0]?.value ?? '',
    semesters,
    categories,
    officers,
  };
}

function dependenciesWithDefaults(
  dependencies: RepositoryDependencies = {},
): ResolvedDependencies {
  return {
    fileSystem: dependencies.fileSystem ?? nodeFileSystem,
    createTemporarySuffix:
      dependencies.createTemporarySuffix ??
      (() => `${process.pid}-${randomUUID()}`),
  };
}

function cloneState(state: LedgerState): LedgerState {
  return structuredClone(state);
}

function cloneIssues(issues: readonly LedgerIssue[]): LedgerIssue[] {
  return structuredClone([...issues]);
}

function hashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function errorCode(error: unknown): string {
  if (error === null || typeof error !== 'object') return 'UNKNOWN';
  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
    ? code
    : 'UNKNOWN';
}

function fileIssue(
  source: SourceKind,
  path: string,
  error: unknown,
): LedgerIssue {
  if (isMissingFile(error)) {
    return {source, field: 'file', message: 'Ledger file is missing'};
  }
  return {
    source,
    field: 'file',
    value: path,
    message: `Ledger file could not be read (${errorCode(error)})`,
  };
}

function arithmeticIssue(): LedgerIssue {
  return {
    source: 'transactions',
    field: 'amount',
    message: 'Ledger calculation exceeds the safe integer range',
  };
}

async function readSource(
  path: string,
  source: SourceKind,
  fileSystem: typeof import('node:fs/promises'),
): Promise<ReadResult> {
  try {
    const bytes = await fileSystem.readFile(path);
    return {bytes, text: bytes.toString('utf8'), issue: null};
  } catch (error) {
    return {bytes: null, text: null, issue: fileIssue(source, path, error)};
  }
}

function validationIssues(error: unknown): LedgerIssue[] {
  if (error instanceof LedgerValidationError) {
    return cloneIssues(error.issues);
  }
  if (error instanceof RangeError) {
    return [arithmeticIssue()];
  }
  throw error;
}

function inspectPair(
  settingsText: string | null,
  transactionsText: string | null,
  initialIssues: readonly LedgerIssue[] = [],
): {issues: LedgerIssue[]; state: LedgerState | null} {
  const issues = cloneIssues(initialIssues);
  let settings: LedgerSettings | null = null;
  let transactions: Transaction[] | null = null;

  if (settingsText !== null) {
    try {
      settings = parseSettingsText(settingsText);
    } catch (error) {
      issues.push(...validationIssues(error));
    }
  }

  if (transactionsText !== null) {
    try {
      transactions = parseTransactionsCsv(
        transactionsText,
        settings ?? independentTransactionSettings(transactionsText),
      );
    } catch (error) {
      issues.push(...validationIssues(error));
    }
  }

  if (transactions !== null) {
    try {
      calculateTotals(transactions);
    } catch (error) {
      issues.push(...validationIssues(error));
    }
  }

  return {
    issues,
    state:
      issues.length === 0 && settings !== null && transactions !== null
        ? cloneState({settings, transactions})
        : null,
  };
}

async function inspectLedgerRootWithDependencies(
  root: string,
  dependencies: ResolvedDependencies,
): Promise<InternalInspection> {
  const resolvedRoot = resolve(root);
  const paths = ledgerPaths(resolvedRoot);
  const [settingsRead, transactionsRead] = await Promise.all([
    readSource(paths.settings, 'settings', dependencies.fileSystem),
    readSource(paths.transactions, 'transactions', dependencies.fileSystem),
  ]);
  const initialIssues = [settingsRead.issue, transactionsRead.issue].filter(
    (issue): issue is LedgerIssue => issue !== null,
  );
  const pair = inspectPair(
    settingsRead.text,
    transactionsRead.text,
    initialIssues,
  );

  return {
    root: resolvedRoot,
    settingsText: settingsRead.text,
    transactionsText: transactionsRead.text,
    issues: cloneIssues(pair.issues),
    state: pair.state === null ? null : cloneState(pair.state),
    sourceBytes: {
      settings: settingsRead.bytes,
      transactions: transactionsRead.bytes,
    },
  };
}

function publicInspection(inspection: InternalInspection): LedgerInspection {
  return {
    root: inspection.root,
    settingsText: inspection.settingsText,
    transactionsText: inspection.transactionsText,
    issues: cloneIssues(inspection.issues),
    state: inspection.state === null ? null : cloneState(inspection.state),
  };
}

function requireInspectionState(inspection: LedgerInspection): LedgerState {
  if (inspection.state === null) {
    throw new LedgerValidationError(inspection.issues);
  }
  return cloneState(inspection.state);
}

function inspectionHashes(
  inspection: InternalInspection,
): Record<SourceKind, string> {
  const settings = inspection.sourceBytes.settings;
  const transactions = inspection.sourceBytes.transactions;
  if (settings === null || transactions === null) {
    throw new LedgerValidationError(inspection.issues);
  }
  return {
    settings: hashBytes(settings),
    transactions: hashBytes(transactions),
  };
}

function canonicalPair(
  settingsCandidate: LedgerSettings,
  transactionsCandidate: Transaction[],
): ValidPair {
  const settingsText = serializeSettings(settingsCandidate);
  const settings = parseSettingsText(settingsText);
  const transactionsText = serializeTransactionsCsv(
    transactionsCandidate,
    settings,
  );
  const transactions = parseTransactionsCsv(transactionsText, settings);
  let totals: Totals;

  try {
    totals = calculateTotals(transactions);
  } catch (error) {
    throw new LedgerValidationError(validationIssues(error));
  }

  return {
    settingsText,
    transactionsText,
    state: cloneState({settings, transactions}),
    totals: {...totals},
  };
}

async function readBackup(
  path: string,
  kind: SourceKind,
  dependencies: ResolvedDependencies,
): Promise<{bytes: Buffer; text: string}> {
  try {
    const bytes = await dependencies.fileSystem.readFile(path);
    return {bytes, text: bytes.toString('utf8')};
  } catch (error) {
    if (isMissingFile(error)) throw new MissingBackupError(path);
    throw new LedgerValidationError([
      {
        source: kind,
        field: 'file',
        value: path,
        message: `Backup file could not be read (${errorCode(error)})`,
      },
    ]);
  }
}

async function inspectLedgerBackupWithDependencies(
  root: string,
  kind: SourceKind,
  dependencies: ResolvedDependencies,
): Promise<{
  inspection: BackupInspection;
  backupBytes: Buffer;
  companionBytes: Buffer;
}> {
  const paths = ledgerPaths(root);
  const backupPath =
    kind === 'settings' ? paths.settingsBackup : paths.transactionsBackup;
  const companionPath =
    kind === 'settings' ? paths.transactions : paths.settings;
  const companionKind: SourceKind =
    kind === 'settings' ? 'transactions' : 'settings';
  const [backup, companionRead] = await Promise.all([
    readBackup(backupPath, kind, dependencies),
    readSource(companionPath, companionKind, dependencies.fileSystem),
  ]);
  const settingsText = kind === 'settings' ? backup.text : companionRead.text;
  const transactionsText =
    kind === 'transactions' ? backup.text : companionRead.text;
  const initialIssues = companionRead.issue === null ? [] : [companionRead.issue];
  const pair = inspectPair(settingsText, transactionsText, initialIssues);

  if (pair.state === null) throw new LedgerValidationError(pair.issues);
  if (companionRead.bytes === null) {
    throw new SourceConflictError(companionPath);
  }

  let totals: Totals;
  try {
    totals = calculateTotals(pair.state.transactions);
  } catch (error) {
    throw new LedgerValidationError(validationIssues(error));
  }

  return {
    backupBytes: backup.bytes,
    companionBytes: companionRead.bytes,
    inspection: {
      kind,
      transactions: pair.state.transactions.length,
      totals: {...totals},
      state: cloneState(pair.state),
    },
  };
}

function temporaryPath(
  destination: string,
  dependencies: ResolvedDependencies,
): string {
  return join(
    dirname(destination),
    `.${basename(destination)}.${dependencies.createTemporarySuffix()}.tmp`,
  );
}

async function removeTemporary(
  path: string,
  fileSystem: typeof import('node:fs/promises'),
): Promise<void> {
  try {
    await fileSystem.rm(path, {force: true});
  } catch {
    // Cleanup must not replace the operation's original failure.
  }
}

async function closeHandle(handle: FileHandle | null): Promise<void> {
  if (handle === null) return;
  try {
    await handle.close();
  } catch {
    // Cleanup must not replace the operation's original failure.
  }
}

async function stageFile(
  destination: string,
  payload: FilePayload,
  dependencies: ResolvedDependencies,
): Promise<string> {
  const path = temporaryPath(destination, dependencies);
  let handle: FileHandle | null = null;
  let ownsTemporary = false;

  try {
    handle = await dependencies.fileSystem.open(path, 'wx');
    ownsTemporary = true;
    await handle.writeFile(payload);
    await handle.sync();
    await handle.close();
    handle = null;
    return path;
  } catch (error) {
    await closeHandle(handle);
    if (ownsTemporary) {
      await removeTemporary(path, dependencies.fileSystem);
    }
    throw error;
  }
}

async function syncDirectory(
  directory: string,
  dependencies: ResolvedDependencies,
): Promise<void> {
  let handle: FileHandle | null = null;
  try {
    handle = await dependencies.fileSystem.open(directory, 'r');
    await handle.sync();
  } finally {
    await closeHandle(handle);
  }
}

function sourcePath(
  paths: ReturnType<typeof ledgerPaths>,
  kind: SourceKind,
): string {
  return kind === 'settings' ? paths.settings : paths.transactions;
}

function backupPath(
  paths: ReturnType<typeof ledgerPaths>,
  kind: SourceKind,
): string {
  return kind === 'settings' ? paths.settingsBackup : paths.transactionsBackup;
}

function otherKind(kind: SourceKind): SourceKind {
  return kind === 'settings' ? 'transactions' : 'settings';
}

async function readExpectedSource(
  kind: SourceKind,
  path: string,
  expectedHash: string,
  dependencies: ResolvedDependencies,
): Promise<Buffer> {
  let bytes: Buffer;
  try {
    bytes = await dependencies.fileSystem.readFile(path);
  } catch (error) {
    if (isMissingFile(error)) throw new SourceConflictError(path);
    throw new LedgerValidationError([fileIssue(kind, path, error)]);
  }
  if (hashBytes(bytes) !== expectedHash) throw new SourceConflictError(path);
  return bytes;
}

async function readExpectedSources(
  paths: ReturnType<typeof ledgerPaths>,
  expectedHashes: Readonly<Record<SourceKind, string>>,
  dependencies: ResolvedDependencies,
): Promise<Record<SourceKind, Buffer>> {
  const settings = await readExpectedSource(
    'settings',
    paths.settings,
    expectedHashes.settings,
    dependencies,
  );
  const transactions = await readExpectedSource(
    'transactions',
    paths.transactions,
    expectedHashes.transactions,
    dependencies,
  );
  return {settings, transactions};
}

function isAlreadyExists(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  );
}

async function createDirectoryDurably(
  directory: string,
  dependencies: ResolvedDependencies,
): Promise<void> {
  try {
    await dependencies.fileSystem.mkdir(directory);
  } catch (error) {
    if (isAlreadyExists(error)) return;
    throw error;
  }
  await syncDirectory(dirname(directory), dependencies);
}

async function ensureBackupDirectory(
  root: string,
  dependencies: ResolvedDependencies,
): Promise<void> {
  const local = join(root, '.local');
  await createDirectoryDurably(local, dependencies);
  await createDirectoryDurably(join(local, 'backups'), dependencies);
}

async function readOptionalFile(
  path: string,
  kind: SourceKind,
  dependencies: ResolvedDependencies,
): Promise<Buffer | null> {
  try {
    return await dependencies.fileSystem.readFile(path);
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw new LedgerValidationError([
      {
        source: kind,
        field: 'file',
        value: path,
        message: `Backup file could not be read (${errorCode(error)})`,
      },
    ]);
  }
}

async function renameWithoutDirectorySync(
  destination: string,
  payload: FilePayload,
  dependencies: ResolvedDependencies,
): Promise<void> {
  let temporary: string | null = await stageFile(
    destination,
    payload,
    dependencies,
  );
  try {
    await dependencies.fileSystem.rename(temporary, destination);
    temporary = null;
  } finally {
    if (temporary !== null) {
      await removeTemporary(temporary, dependencies.fileSystem);
    }
  }
}

async function syncDistinctDirectories(
  paths: readonly string[],
  dependencies: ResolvedDependencies,
): Promise<void> {
  const directories = [...new Set(paths.map(dirname))];
  for (const directory of directories) {
    await syncDirectory(directory, dependencies);
  }
}

async function restoreSnapshot(
  path: string,
  snapshot: Buffer | null,
  dependencies: ResolvedDependencies,
): Promise<void> {
  if (snapshot === null) {
    await dependencies.fileSystem.rm(path, {force: true});
    return;
  }
  await renameWithoutDirectorySync(path, snapshot, dependencies);
}

function sameBytes(left: Buffer | null, right: Buffer | null): boolean {
  if (left === null || right === null) return left === right;
  return left.equals(right);
}

async function readRollbackBytes(
  path: string,
  dependencies: ResolvedDependencies,
): Promise<Buffer | null> {
  try {
    return await dependencies.fileSystem.readFile(path);
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function requireRawSnapshots(
  snapshots: ReadonlyArray<readonly [string, Buffer]>,
  dependencies: ResolvedDependencies,
): Promise<void> {
  for (const [path, expected] of snapshots) {
    const current = await readRollbackBytes(path, dependencies);
    if (!sameBytes(current, expected)) throw new SourceConflictError(path);
  }
}

async function restoreOwnedSnapshot(
  path: string,
  snapshot: Buffer | null,
  installed: Buffer,
  dependencies: ResolvedDependencies,
): Promise<void> {
  const current = await readRollbackBytes(path, dependencies);
  if (sameBytes(current, snapshot)) return;
  if (!sameBytes(current, installed)) throw new SourceConflictError(path);
  await restoreSnapshot(path, snapshot, dependencies);
}

function settledErrors(results: readonly PromiseSettledResult<unknown>[]): unknown[] {
  return results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
}

async function rollbackSnapshots(
  snapshots: ReadonlyArray<readonly [string, Buffer | null, Buffer]>,
  dependencies: ResolvedDependencies,
): Promise<unknown[]> {
  const restored = await Promise.allSettled(
    snapshots.map(([path, snapshot, installed]) =>
      restoreOwnedSnapshot(path, snapshot, installed, dependencies),
    ),
  );
  const synced = await Promise.allSettled(
    [...new Set(snapshots.map(([path]) => dirname(path)))].map((directory) =>
      syncDirectory(directory, dependencies),
    ),
  );
  return [...settledErrors(restored), ...settledErrors(synced)];
}

function throwAfterRollback(
  error: unknown,
  rollbackErrors: readonly unknown[],
  message: string,
): never {
  const distinctRollbackErrors = rollbackErrors.filter(
    (rollbackError) =>
      !(
        error instanceof SourceConflictError &&
        rollbackError instanceof SourceConflictError &&
        error.path === rollbackError.path
      ),
  );
  if (distinctRollbackErrors.length > 0) {
    throw new AggregateError([error, ...distinctRollbackErrors], message);
  }
  throw error;
}

function requireInspectionHashes(
  inspection: InternalInspection,
  paths: ReturnType<typeof ledgerPaths>,
  expectedHashes: Readonly<Record<SourceKind, string>>,
): void {
  for (const kind of ['settings', 'transactions'] as const) {
    const bytes = inspection.sourceBytes[kind];
    if (bytes === null || hashBytes(bytes) !== expectedHashes[kind]) {
      throw new SourceConflictError(sourcePath(paths, kind));
    }
  }
}

async function coordinatedSave(
  root: string,
  kind: SourceKind,
  nextText: string,
  expectedHashes: Readonly<Record<SourceKind, string>>,
  dependencies: ResolvedDependencies,
): Promise<InternalInspection> {
  const paths = ledgerPaths(root);
  const currentPath = sourcePath(paths, kind);
  const selectedBackupPath = backupPath(paths, kind);
  const companionKind = otherKind(kind);
  const companionPath = sourcePath(paths, companionKind);
  const originals = await readExpectedSources(paths, expectedHashes, dependencies);
  const originalBackup = await readOptionalFile(
    selectedBackupPath,
    kind,
    dependencies,
  );
  await ensureBackupDirectory(root, dependencies);

  const nextBytes = Buffer.from(nextText, 'utf8');
  let currentTemporary: string | null = null;
  let backupTemporary: string | null = null;
  let currentRenameAttempted = false;
  let backupRenameAttempted = false;

  try {
    currentTemporary = await stageFile(currentPath, nextBytes, dependencies);
    backupTemporary = await stageFile(
      selectedBackupPath,
      originals[kind],
      dependencies,
    );
    await readExpectedSources(paths, expectedHashes, dependencies);

    backupRenameAttempted = true;
    await dependencies.fileSystem.rename(
      backupTemporary,
      selectedBackupPath,
    );
    backupTemporary = null;
    await syncDirectory(dirname(selectedBackupPath), dependencies);
    await readExpectedSources(paths, expectedHashes, dependencies);
    await requireRawSnapshots(
      [[selectedBackupPath, originals[kind]]],
      dependencies,
    );

    currentRenameAttempted = true;
    await dependencies.fileSystem.rename(currentTemporary, currentPath);
    currentTemporary = null;
    await syncDirectory(dirname(currentPath), dependencies);
    await readExpectedSource(
      companionKind,
      companionPath,
      expectedHashes[companionKind],
      dependencies,
    );

    const inspection = await inspectLedgerRootWithDependencies(
      root,
      dependencies,
    );
    requireInspectionState(inspection);
    requireInspectionHashes(inspection, paths, {
      ...expectedHashes,
      [kind]: hashBytes(nextBytes),
    });
    await requireRawSnapshots(
      [[selectedBackupPath, originals[kind]]],
      dependencies,
    );
    return inspection;
  } catch (error) {
    if (currentTemporary !== null) {
      await removeTemporary(currentTemporary, dependencies.fileSystem);
      currentTemporary = null;
    }
    if (backupTemporary !== null) {
      await removeTemporary(backupTemporary, dependencies.fileSystem);
      backupTemporary = null;
    }
    if (currentRenameAttempted || backupRenameAttempted) {
      const rollbackErrors = await rollbackSnapshots(
        [
          [currentPath, originals[kind], nextBytes],
          [selectedBackupPath, originalBackup, originals[kind]],
        ],
        dependencies,
      );
      throwAfterRollback(
        error,
        rollbackErrors,
        'Ledger save failed and could not be rolled back',
      );
    }
    throw error;
  } finally {
    if (currentTemporary !== null) {
      await removeTemporary(currentTemporary, dependencies.fileSystem);
    }
    if (backupTemporary !== null) {
      await removeTemporary(backupTemporary, dependencies.fileSystem);
    }
  }
}

async function coordinatedSwap(
  currentPath: string,
  backupPath: string,
  companionPath: string,
  currentBytes: Buffer,
  backupBytes: Buffer,
  companionBytes: Buffer,
  dependencies: ResolvedDependencies,
  verify: () => Promise<InternalInspection>,
): Promise<InternalInspection> {
  let currentTemporary: string | null = null;
  let backupTemporary: string | null = null;
  let currentRenameAttempted = false;
  let backupRenameAttempted = false;

  try {
    currentTemporary = await stageFile(currentPath, backupBytes, dependencies);
    backupTemporary = await stageFile(backupPath, currentBytes, dependencies);
    await requireRawSnapshots(
      [
        [currentPath, currentBytes],
        [backupPath, backupBytes],
        [companionPath, companionBytes],
      ],
      dependencies,
    );

    currentRenameAttempted = true;
    await dependencies.fileSystem.rename(currentTemporary, currentPath);
    currentTemporary = null;
    await requireRawSnapshots(
      [
        [currentPath, backupBytes],
        [backupPath, backupBytes],
        [companionPath, companionBytes],
      ],
      dependencies,
    );

    backupRenameAttempted = true;
    await dependencies.fileSystem.rename(backupTemporary, backupPath);
    backupTemporary = null;

    await syncDistinctDirectories([currentPath, backupPath], dependencies);
    const swappedSnapshots = [
      [currentPath, backupBytes],
      [backupPath, currentBytes],
      [companionPath, companionBytes],
    ] as const;
    await requireRawSnapshots(swappedSnapshots, dependencies);
    const inspection = await verify();
    await requireRawSnapshots(swappedSnapshots, dependencies);
    return inspection;
  } catch (error) {
    if (currentTemporary !== null) {
      await removeTemporary(currentTemporary, dependencies.fileSystem);
      currentTemporary = null;
    }
    if (backupTemporary !== null) {
      await removeTemporary(backupTemporary, dependencies.fileSystem);
      backupTemporary = null;
    }
    if (currentRenameAttempted || backupRenameAttempted) {
      const rollbackErrors = await rollbackSnapshots(
        [
          [
            currentPath,
            currentBytes,
            backupBytes,
          ],
          [backupPath, backupBytes, currentBytes],
        ],
        dependencies,
      );
      throwAfterRollback(
        error,
        rollbackErrors,
        'Ledger restore failed and could not be rolled back',
      );
    }
    throw error;
  } finally {
    if (currentTemporary !== null) {
      await removeTemporary(currentTemporary, dependencies.fileSystem);
    }
    if (backupTemporary !== null) {
      await removeTemporary(backupTemporary, dependencies.fileSystem);
    }
  }
}

export function ledgerPaths(root: string): {
  settings: string;
  transactions: string;
  settingsBackup: string;
  transactionsBackup: string;
} {
  const resolvedRoot = resolve(root);
  return {
    settings: join(resolvedRoot, 'data/settings.json'),
    transactions: join(resolvedRoot, 'data/transactions.csv'),
    settingsBackup: join(resolvedRoot, '.local/backups/settings.json'),
    transactionsBackup: join(
      resolvedRoot,
      '.local/backups/transactions.csv',
    ),
  };
}

export async function inspectLedgerRoot(root: string): Promise<LedgerInspection> {
  return publicInspection(
    await inspectLedgerRootWithDependencies(root, dependenciesWithDefaults()),
  );
}

export async function inspectLedgerBackup(
  root: string,
  kind: SourceKind,
  dependencies?: RepositoryDependencies,
): Promise<BackupInspection> {
  const result = await inspectLedgerBackupWithDependencies(
    root,
    kind,
    dependenciesWithDefaults(dependencies),
  );
  return {
    ...result.inspection,
    totals: {...result.inspection.totals},
    state: cloneState(result.inspection.state),
  };
}

async function restoreLedgerBackupWithDependencies(
  root: string,
  kind: SourceKind,
  resolvedDependencies: ResolvedDependencies,
): Promise<InternalInspection> {
  const resolvedRoot = resolve(root);
  const paths = ledgerPaths(resolvedRoot);
  const currentPath = kind === 'settings' ? paths.settings : paths.transactions;
  const backupPath =
    kind === 'settings' ? paths.settingsBackup : paths.transactionsBackup;
  const companionPath = sourcePath(paths, otherKind(kind));
  const backup = await inspectLedgerBackupWithDependencies(
    resolvedRoot,
    kind,
    resolvedDependencies,
  );
  let currentBytes: Buffer;
  try {
    currentBytes = await resolvedDependencies.fileSystem.readFile(currentPath);
  } catch (error) {
    throw new LedgerValidationError([fileIssue(kind, currentPath, error)]);
  }

  return coordinatedSwap(
    currentPath,
    backupPath,
    companionPath,
    currentBytes,
    backup.backupBytes,
    backup.companionBytes,
    resolvedDependencies,
    async () => {
      const inspection = await inspectLedgerRootWithDependencies(
        resolvedRoot,
        resolvedDependencies,
      );
      requireInspectionState(inspection);
      return inspection;
    },
  );
}

export async function restoreLedgerBackup(
  root: string,
  kind: SourceKind,
  dependencies?: RepositoryDependencies,
): Promise<LedgerInspection> {
  return publicInspection(
    await restoreLedgerBackupWithDependencies(
      root,
      kind,
      dependenciesWithDefaults(dependencies),
    ),
  );
}

export class LedgerRepository {
  readonly #root: string;
  readonly #dependencies: ResolvedDependencies;
  #state: LedgerState;
  #hashes: Record<SourceKind, string>;
  #operationTail: Promise<void> = Promise.resolve();

  private constructor(
    dependencies: ResolvedDependencies,
    inspection: InternalInspection,
  ) {
    this.#root = inspection.root;
    this.#dependencies = dependencies;
    this.#state = requireInspectionState(inspection);
    this.#hashes = inspectionHashes(inspection);
  }

  static async open(
    root: string,
    dependencies?: RepositoryDependencies,
  ): Promise<LedgerRepository> {
    const resolvedDependencies = dependenciesWithDefaults(dependencies);
    const inspection = await inspectLedgerRootWithDependencies(
      root,
      resolvedDependencies,
    );
    requireInspectionState(inspection);
    return new LedgerRepository(resolvedDependencies, inspection);
  }

  getState(): LedgerState {
    return cloneState(this.#state);
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #applyInspection(inspection: InternalInspection): void {
    const state = requireInspectionState(inspection);
    const hashes = inspectionHashes(inspection);
    this.#state = state;
    this.#hashes = hashes;
  }

  async #reloadUnlocked(): Promise<void> {
    const inspection = await inspectLedgerRootWithDependencies(
      this.#root,
      this.#dependencies,
    );
    this.#applyInspection(inspection);
  }

  async reload(): Promise<void> {
    return this.#enqueue(() => this.#reloadUnlocked());
  }

  async saveTransactions(next: Transaction[]): Promise<void> {
    return this.#enqueue(async () => {
      const proposed = canonicalPair(this.#state.settings, next);
      const inspection = await coordinatedSave(
        this.#root,
        'transactions',
        proposed.transactionsText,
        this.#hashes,
        this.#dependencies,
      );
      this.#applyInspection(inspection);
    });
  }

  async saveSettings(next: LedgerSettings): Promise<void> {
    return this.#enqueue(async () => {
      const proposed = canonicalPair(next, this.#state.transactions);
      const inspection = await coordinatedSave(
        this.#root,
        'settings',
        proposed.settingsText,
        this.#hashes,
        this.#dependencies,
      );
      this.#applyInspection(inspection);
    });
  }

  async inspectBackup(kind: SourceKind): Promise<BackupInspection> {
    return inspectLedgerBackup(this.#root, kind, this.#dependencies);
  }

  async restore(kind: SourceKind): Promise<void> {
    return this.#enqueue(async () => {
      const inspection = await restoreLedgerBackupWithDependencies(
        this.#root,
        kind,
        this.#dependencies,
      );
      this.#applyInspection(inspection);
    });
  }
}
