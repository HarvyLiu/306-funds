import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';

import {
  createLedgerView,
  emptyFilter,
  LedgerValidationError,
  MissingBackupError,
  previewAdd,
  previewDelete,
  previewEdit,
  SourceConflictError,
  type LedgerFilter,
  type LedgerSettings,
  type LedgerState,
  type MutationPreview,
  type Transaction,
  type TransactionInput,
} from '@class-fund/ledger';
import {
  inspectLedgerBackup,
  inspectLedgerRoot,
  LedgerRepository as LedgerRepositoryClass,
  restoreLedgerBackup,
  type BackupInspection,
  type LedgerInspection,
  type LedgerRepository,
  type SourceKind,
} from '@class-fund/ledger/node';

import {CommandBar} from './components/command-bar.js';
import {FilterBar} from './components/filter-bar.js';
import {Summary} from './components/summary.js';
import {TransactionTable} from './components/transaction-table.js';
import {formatLedgerIssues} from './ledger-issue.js';
import {writeSetupMarker} from './setup-marker.js';
import {ConfirmScreen} from './screens/confirm-screen.js';
import {CheckScreen} from './screens/check-screen.js';
import {DeleteScreen} from './screens/delete-screen.js';
import {FilterScreen} from './screens/filter-screen.js';
import {RecoveryScreen} from './screens/recovery-screen.js';
import {SetupScreen} from './screens/setup-screen.js';
import {SettingsScreen} from './screens/settings-screen.js';
import {TransactionForm} from './screens/transaction-form.js';

export interface ReadyAppProps {
  repository: LedgerRepository;
  inspection?: never;
}

export interface RecoveryAppProps {
  repository?: never;
  inspection: LedgerInspection;
}

export type AppProps = (ReadyAppProps | RecoveryAppProps) & {
  root: string;
  setupComplete: boolean;
  onExit(): void;
  today?: () => string;
};

export type Screen =
  | {name: 'overview'}
  | {name: 'setup'}
  | {name: 'form'; mode: 'add' | 'edit'; transactionId?: string}
  | {name: 'confirm'; preview: MutationPreview}
  | {name: 'delete'; transactionId: string}
  | {name: 'filter'; mode: 'selectors' | 'search'}
  | {name: 'settings'}
  | {name: 'check'}
  | {
      name: 'recovery';
      mode: 'issues' | 'select';
      inspection?: LedgerInspection;
      error?: string;
      origin: 'overview' | 'check';
    }
  | {
      name: 'restore-confirm';
      preview: BackupInspection;
      kind: SourceKind;
      inspection?: LedgerInspection;
      origin: 'overview' | 'check';
    }
  | {name: 'error'; message: string};

type RecoveryOperationKind = 'reload' | 'inspect' | 'restore';

interface RecoveryOperation {
  id: number;
  kind: RecoveryOperationKind;
}

function localToday(): string {
  const date = new Date();
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function transactionInput(transaction: Transaction): TransactionInput {
  return {
    date: transaction.date,
    semester: transaction.semester,
    subject: transaction.subject,
    category: transaction.category,
    type: transaction.type,
    amount: transaction.amount,
    handled_by: transaction.handled_by,
    note: transaction.note,
  };
}

function issueMessage(error: LedgerValidationError): string {
  return formatLedgerIssues(error.issues);
}

function mutationErrorMessage(error: unknown): string {
  if (error instanceof SourceConflictError) {
    return '檔案已被外部修改。請重新載入後再試。';
  }
  if (error instanceof LedgerValidationError) {
    return issueMessage(error);
  }
  return '無法儲存交易，請確認檔案權限後再試一次。';
}

function recoveryErrorMessage(error: unknown, kind?: SourceKind): string {
  if (error instanceof MissingBackupError) {
    return kind === 'settings' ? '找不到設定備份' : '找不到交易備份';
  }
  if (error instanceof LedgerValidationError) {
    return formatLedgerIssues(error.issues, true);
  }
  if (error instanceof SourceConflictError) {
    return '檔案已被外部修改。請重新載入後再試。';
  }
  return '無法讀取或還原備份，請確認檔案權限後再試。';
}

function RecoveryApp({
  root,
  inspection,
  setupComplete,
  onExit,
  today,
}: RecoveryAppProps & {
  root: string;
  setupComplete: boolean;
  onExit(): void;
  today?: () => string;
}) {
  const [currentInspection, setCurrentInspection] = useState(inspection);
  const [mode, setMode] = useState<'issues' | 'select' | 'confirm'>('issues');
  const [preview, setPreview] = useState<BackupInspection | undefined>();
  const [kind, setKind] = useState<SourceKind | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [readyRepository, setReadyRepository] =
    useState<LedgerRepository | null>(null);
  const [pendingOperation, setPendingOperation] =
    useState<RecoveryOperationKind | null>(null);
  const operationRef = useRef<RecoveryOperation | null>(null);
  const nextOperationIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  function startOperation(
    kind: RecoveryOperationKind,
  ): RecoveryOperation | null {
    if (operationRef.current !== null) return null;
    const operation = {id: nextOperationIdRef.current + 1, kind};
    nextOperationIdRef.current = operation.id;
    operationRef.current = operation;
    setPendingOperation(kind);
    return operation;
  }

  function isActiveOperation(operation: RecoveryOperation): boolean {
    return isMountedRef.current && operationRef.current === operation;
  }

  function finishOperation(operation: RecoveryOperation): void {
    if (operationRef.current !== operation) return;
    operationRef.current = null;
    if (isMountedRef.current) setPendingOperation(null);
  }

  async function openIfValid(
    nextInspection: LedgerInspection,
    operation: RecoveryOperation,
  ): Promise<boolean> {
    if (!isActiveOperation(operation)) return false;
    setCurrentInspection(nextInspection);
    if (nextInspection.state === null) return false;
    const repository = await LedgerRepositoryClass.open(root);
    if (!isActiveOperation(operation)) return false;
    setReadyRepository(repository);
    return true;
  }

  async function reload(): Promise<void> {
    const operation = startOperation('reload');
    if (operation === null) return;
    setError(null);
    try {
      const nextInspection = await inspectLedgerRoot(root);
      if (!isActiveOperation(operation)) return;
      if (!(await openIfValid(nextInspection, operation))) {
        if (isActiveOperation(operation)) setMode('issues');
      }
    } catch (nextError) {
      if (!isActiveOperation(operation)) return;
      setError(recoveryErrorMessage(nextError));
      setMode('issues');
    } finally {
      finishOperation(operation);
    }
  }

  async function inspectBackup(kindToInspect: SourceKind): Promise<void> {
    const operation = startOperation('inspect');
    if (operation === null) return;
    setError(null);
    try {
      const nextPreview = await inspectLedgerBackup(root, kindToInspect);
      if (!isActiveOperation(operation)) return;
      setKind(kindToInspect);
      setPreview(nextPreview);
      setMode('confirm');
    } catch (nextError) {
      if (!isActiveOperation(operation)) return;
      setError(recoveryErrorMessage(nextError, kindToInspect));
      setMode('issues');
    } finally {
      finishOperation(operation);
    }
  }

  async function restore(): Promise<void> {
    if (kind === undefined) return;
    const operation = startOperation('restore');
    if (operation === null) return;
    setError(null);
    try {
      const nextInspection = await restoreLedgerBackup(root, kind);
      if (!isActiveOperation(operation)) return;
      if (!(await openIfValid(nextInspection, operation))) {
        if (!isActiveOperation(operation)) return;
        setError('還原後的資料仍有問題，請檢查來源檔案。');
        setMode('issues');
      }
    } catch (nextError) {
      if (!isActiveOperation(operation)) return;
      setError(recoveryErrorMessage(nextError, kind));
      setMode('issues');
    } finally {
      finishOperation(operation);
    }
  }

  if (readyRepository !== null) {
    return (
      <ReadyApp
        root={root}
        repository={readyRepository}
        setupComplete={setupComplete}
        onExit={onExit}
        {...(today === undefined ? {} : {today})}
      />
    );
  }

  return (
    <RecoveryScreen
      mode={mode}
      inspection={currentInspection}
      {...(preview === undefined ? {} : {preview})}
      error={error}
      pending={pendingOperation}
      onReload={() => void reload()}
      onOpenSelection={() => {
        if (operationRef.current !== null) return;
        setError(null);
        setMode('select');
      }}
      onSelect={(selectedKind) => void inspectBackup(selectedKind)}
      onRestore={() => void restore()}
      onCancel={() => {
        if (operationRef.current !== null) return;
        setError(null);
        setMode('issues');
      }}
      onExit={() => {
        if (operationRef.current === null) onExit();
      }}
    />
  );
}

function ReadyApp({
  repository,
  root,
  setupComplete,
  onExit,
  today = localToday,
}: AppProps & ReadyAppProps) {
  const [screen, setScreen] = useState<Screen>(() =>
    setupComplete ? {name: 'overview'} : {name: 'setup'},
  );
  const [state, setState] = useState<LedgerState>(() => repository.getState());
  const [setupError, setSetupError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilter>(() => ({...emptyFilter}));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [formToday, setFormToday] = useState('');
  const [pendingRecoveryOperation, setPendingRecoveryOperation] =
    useState<RecoveryOperationKind | null>(null);
  const recoveryOperationRef = useRef<RecoveryOperation | null>(null);
  const nextRecoveryOperationIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const {columns} = useWindowSize();
  const view = useMemo(
    () => createLedgerView(state.transactions, filter),
    [filter, state.transactions],
  );
  const hasFilters =
    filter.semester !== null ||
    filter.category !== null ||
    filter.handledBy !== null ||
    filter.type !== null ||
    filter.search.trim() !== '';

  useEffect(() => {
    setSelectedIndex((current) =>
      view.rows.length === 0 ? 0 : Math.min(current, view.rows.length - 1),
    );
  }, [view.rows.length]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  function startRecoveryOperation(
    kind: RecoveryOperationKind,
  ): RecoveryOperation | null {
    if (recoveryOperationRef.current !== null) return null;
    const operation = {
      id: nextRecoveryOperationIdRef.current + 1,
      kind,
    };
    nextRecoveryOperationIdRef.current = operation.id;
    recoveryOperationRef.current = operation;
    setPendingRecoveryOperation(kind);
    return operation;
  }

  function isActiveRecoveryOperation(
    operation: RecoveryOperation,
  ): boolean {
    return isMountedRef.current && recoveryOperationRef.current === operation;
  }

  function finishRecoveryOperation(operation: RecoveryOperation): void {
    if (recoveryOperationRef.current !== operation) return;
    recoveryOperationRef.current = null;
    if (isMountedRef.current) setPendingRecoveryOperation(null);
  }

  useInput(
    (input, key) => {
      if (input === 'q') {
        onExit();
        return;
      }
      if (input === 'a') {
        setFormToday(today());
        setScreen({name: 'form', mode: 'add'});
      } else if (input === 'e') {
        const transaction = view.rows[selectedIndex]?.transaction;
        if (transaction !== undefined) {
          setFormToday(today());
          setScreen({
            name: 'form',
            mode: 'edit',
            transactionId: transaction.id,
          });
        }
      } else if (input === 'd') {
        const transaction = view.rows[selectedIndex]?.transaction;
        if (transaction !== undefined) {
          try {
            previewDelete(state, transaction.id);
            setScreen({name: 'delete', transactionId: transaction.id});
          } catch (error) {
            setScreen({name: 'error', message: mutationErrorMessage(error)});
          }
        }
      } else if (input === 'f') {
        setScreen({name: 'filter', mode: 'selectors'});
      } else if (input === '/') {
        setScreen({name: 'filter', mode: 'search'});
      } else if (input === 's') {
        setScreen({name: 'settings'});
      } else if (input === 'p') {
        setScreen({name: 'check'});
      } else if (input === 'r') {
        setScreen({name: 'recovery', mode: 'select', origin: 'overview'});
      } else if (key.escape && filter.search.trim() !== '') {
        setFilter((current) => ({...current, search: ''}));
      } else if (key.downArrow || input === 'j') {
        setSelectedIndex((current) =>
          view.rows.length === 0
            ? 0
            : Math.min(current + 1, view.rows.length - 1),
        );
      } else if (key.upArrow || input === 'k') {
        setSelectedIndex((current) => Math.max(current - 1, 0));
      }
    },
    {isActive: screen.name === 'overview'},
  );

  async function completeSetup(settings: LedgerSettings): Promise<void> {
    setSetupError(null);
    try {
      await repository.saveSettings(settings);
    } catch {
      setSetupError('無法儲存初始設定，請確認檔案權限後再試一次');
      return;
    }

    try {
      await writeSetupMarker(root);
    } catch {
      setSetupError(
        '設定已儲存，但無法建立初始設定標記，請確認檔案權限後再試一次',
      );
      return;
    }

    setState(repository.getState());
    setScreen({name: 'overview'});
  }

  function reviewTransaction(input: TransactionInput): void {
    if (screen.name !== 'form') return;
    try {
      const preview =
        screen.mode === 'add'
          ? previewAdd(state, input)
          : previewEdit(state, screen.transactionId!, input);
      setScreen({name: 'confirm', preview});
    } catch (error) {
      setScreen({name: 'error', message: mutationErrorMessage(error)});
    }
  }

  async function persistPreview(preview: MutationPreview): Promise<void> {
    try {
      await repository.saveTransactions(preview.nextTransactions);
      const nextState = repository.getState();
      setState(nextState);

      if (preview.kind !== 'delete') {
        const rows = createLedgerView(nextState.transactions, filter).rows;
        const nextIndex = rows.findIndex(
          (row) => row.transaction.id === preview.target.id,
        );
        if (nextIndex >= 0) setSelectedIndex(nextIndex);
      }
      setScreen({name: 'overview'});
    } catch (error) {
      setScreen({name: 'error', message: mutationErrorMessage(error)});
    }
  }

  async function saveSettings(settings: LedgerSettings): Promise<void> {
    await repository.saveSettings(settings);
    if (!isMountedRef.current) return;
    setState(repository.getState());
  }

  const enterRecoveryAfterCheck = useCallback(async (): Promise<void> => {
    try {
      const inspection = await inspectLedgerRoot(root);
      if (!isMountedRef.current) return;
      setScreen({name: 'recovery', mode: 'issues', inspection, origin: 'check'});
    } catch (error) {
      if (!isMountedRef.current) return;
      setScreen({
        name: 'recovery',
        mode: 'issues',
        origin: 'check',
        error: recoveryErrorMessage(error),
      });
    }
  }, [root]);

  async function inspectReadyBackup(
    kind: SourceKind,
    origin: 'overview' | 'check',
    inspection?: LedgerInspection,
  ): Promise<void> {
    const operation = startRecoveryOperation('inspect');
    if (operation === null) return;
    try {
      const backup = await repository.inspectBackup(kind);
      if (!isActiveRecoveryOperation(operation)) return;
      setScreen({
        name: 'restore-confirm',
        preview: backup,
        kind,
        origin,
        ...(inspection === undefined ? {} : {inspection}),
      });
    } catch (error) {
      if (!isActiveRecoveryOperation(operation)) return;
      setScreen({
        name: 'recovery',
        mode: 'issues',
        origin,
        ...(inspection === undefined ? {} : {inspection}),
        error: recoveryErrorMessage(error, kind),
      });
    } finally {
      finishRecoveryOperation(operation);
    }
  }

  async function reloadReadyRecovery(
    origin: 'overview' | 'check',
  ): Promise<void> {
    const operation = startRecoveryOperation('reload');
    if (operation === null) return;
    try {
      const inspection = await inspectLedgerRoot(root);
      if (!isActiveRecoveryOperation(operation)) return;
      if (inspection.state === null) {
        setScreen({name: 'recovery', mode: 'issues', inspection, origin});
        return;
      }
      await repository.reload();
      if (!isActiveRecoveryOperation(operation)) return;
      setState(repository.getState());
      setScreen({name: 'overview'});
    } catch (error) {
      if (!isActiveRecoveryOperation(operation)) return;
      setScreen({
        name: 'recovery',
        mode: 'issues',
        origin,
        error: recoveryErrorMessage(error),
      });
    } finally {
      finishRecoveryOperation(operation);
    }
  }

  async function restoreReadyBackup(
    kind: SourceKind,
    origin: 'overview' | 'check',
    inspection?: LedgerInspection,
  ): Promise<void> {
    const operation = startRecoveryOperation('restore');
    if (operation === null) return;
    try {
      await repository.restore(kind);
      if (!isActiveRecoveryOperation(operation)) return;
      const reopened = await LedgerRepositoryClass.open(root);
      if (!isActiveRecoveryOperation(operation)) return;
      setState(reopened.getState());
      setScreen({name: 'overview'});
    } catch (error) {
      if (!isActiveRecoveryOperation(operation)) return;
      setScreen({
        name: 'recovery',
        mode: 'issues',
        origin,
        ...(inspection === undefined ? {} : {inspection}),
        error: recoveryErrorMessage(error, kind),
      });
    } finally {
      finishRecoveryOperation(operation);
    }
  }

  function cancelRecovery(
    inspection: LedgerInspection | undefined,
    origin: 'overview' | 'check',
  ): void {
    if (recoveryOperationRef.current !== null) return;
    if (inspection?.state === null) {
      setScreen({name: 'recovery', mode: 'issues', inspection, origin});
      return;
    }
    setScreen({name: 'overview'});
  }

  function confirmDelete(transactionId: string): void {
    try {
      const preview = previewDelete(state, transactionId);
      void persistPreview(preview);
    } catch (error) {
      setScreen({name: 'error', message: mutationErrorMessage(error)});
    }
  }

  if (screen.name === 'setup') {
    return (
      <SetupScreen
        settings={state.settings}
        transactions={state.transactions}
        onSubmit={completeSetup}
        error={setupError}
      />
    );
  }

  if (screen.name === 'form') {
    const transaction =
      screen.mode === 'edit'
        ? state.transactions.find(
            (candidate) => candidate.id === screen.transactionId,
          )
        : undefined;
    if (screen.mode === 'edit' && transaction === undefined) {
      return (
        <ModalError
          message="找不到選取的交易。"
          onBack={() => setScreen({name: 'overview'})}
        />
      );
    }
    return (
      <TransactionForm
        mode={screen.mode}
        settings={state.settings}
        {...(transaction === undefined
          ? {}
          : {initialValue: transactionInput(transaction)})}
        today={formToday}
        onReview={reviewTransaction}
        onCancel={() => setScreen({name: 'overview'})}
      />
    );
  }

  if (screen.name === 'confirm') {
    return (
      <ConfirmScreen
        preview={screen.preview}
        onConfirm={() => void persistPreview(screen.preview)}
        onCancel={() => setScreen({name: 'overview'})}
      />
    );
  }

  if (screen.name === 'delete') {
    const transaction = state.transactions.find(
      (candidate) => candidate.id === screen.transactionId,
    );
    if (transaction === undefined) {
      return (
        <ModalError
          message="找不到選取的交易。"
          onBack={() => setScreen({name: 'overview'})}
        />
      );
    }
    return (
      <DeleteScreen
        transaction={transaction}
        onConfirm={() => confirmDelete(screen.transactionId)}
        onCancel={() => setScreen({name: 'overview'})}
      />
    );
  }

  if (screen.name === 'filter') {
    return (
      <FilterScreen
        filter={filter}
        settings={state.settings}
        transactions={state.transactions}
        mode={screen.mode}
        onApply={(nextFilter) => {
          setFilter({...nextFilter});
          setSelectedIndex(0);
          setScreen({name: 'overview'});
        }}
        onCancel={() => setScreen({name: 'overview'})}
      />
    );
  }

  if (screen.name === 'settings') {
    return (
      <SettingsScreen
        state={state}
        onSave={saveSettings}
        onSaved={() => setScreen({name: 'overview'})}
        onCancel={() => setScreen({name: 'overview'})}
      />
    );
  }

  if (screen.name === 'check') {
    return (
      <CheckScreen
        repository={repository}
        filter={filter}
        onFailure={enterRecoveryAfterCheck}
        onCancel={() => {
          setState(repository.getState());
          setScreen({name: 'overview'});
        }}
      />
    );
  }

  if (screen.name === 'recovery') {
    return (
      <RecoveryScreen
        mode={screen.mode}
        {...(screen.inspection === undefined
          ? {}
          : {inspection: screen.inspection})}
        {...(screen.error === undefined ? {} : {error: screen.error})}
        pending={pendingRecoveryOperation}
        onReload={() => void reloadReadyRecovery(screen.origin)}
        onOpenSelection={() => {
          if (recoveryOperationRef.current !== null) return;
          setScreen({
            name: 'recovery',
            mode: 'select',
            origin: screen.origin,
            ...(screen.inspection === undefined
              ? {}
              : {inspection: screen.inspection}),
          })
        }}
        onSelect={(kind) =>
          void inspectReadyBackup(kind, screen.origin, screen.inspection)
        }
        onRestore={() => undefined}
        onCancel={() => cancelRecovery(screen.inspection, screen.origin)}
        onExit={() => {
          if (recoveryOperationRef.current === null) onExit();
        }}
      />
    );
  }

  if (screen.name === 'restore-confirm') {
    return (
      <RecoveryScreen
        mode="confirm"
        preview={screen.preview}
        pending={pendingRecoveryOperation}
        {...(screen.inspection === undefined
          ? {}
          : {inspection: screen.inspection})}
        onReload={() => undefined}
        onOpenSelection={() => undefined}
        onSelect={() => undefined}
        onRestore={() =>
          void restoreReadyBackup(
            screen.kind,
            screen.origin,
            screen.inspection,
          )
        }
        onCancel={() => cancelRecovery(screen.inspection, screen.origin)}
        onExit={() => {
          if (recoveryOperationRef.current === null) onExit();
        }}
      />
    );
  }

  if (screen.name === 'error') {
    return (
      <ModalError
        message={screen.message}
        onBack={() => setScreen({name: 'overview'})}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>班費帳本</Text>
      <Summary
        overall={view.overall}
        filtered={view.filtered}
        hasFilters={hasFilters}
      />
      <FilterBar filter={filter} />
      <TransactionTable
        rows={view.rows}
        selectedIndex={selectedIndex}
        width={columns ?? 80}
      />
      <CommandBar />
    </Box>
  );
}

function ModalError({message, onBack}: {message: string; onBack(): void}) {
  useInput((_input, key) => {
    if (key.escape || key.return) onBack();
  });

  return (
    <Box flexDirection="column">
      <Text bold>無法完成交易</Text>
      <Text color="red">{message}</Text>
      <Text>按 Enter 或 Esc 返回</Text>
    </Box>
  );
}

function isReadyApp(props: AppProps): props is AppProps & ReadyAppProps {
  return props.repository !== undefined;
}

export function App(props: AppProps) {
  if (!isReadyApp(props)) {
    return (
      <RecoveryApp
        root={props.root}
        inspection={props.inspection}
        setupComplete={props.setupComplete}
        onExit={props.onExit}
        {...(props.today === undefined ? {} : {today: props.today})}
      />
    );
  }

  return <ReadyApp {...props} />;
}
