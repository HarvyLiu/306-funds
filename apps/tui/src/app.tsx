import {useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';

import {
  createLedgerView,
  emptyFilter,
  LedgerValidationError,
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
import type {LedgerInspection, LedgerRepository} from '@class-fund/ledger/node';

import {CommandBar} from './components/command-bar.js';
import {FilterBar} from './components/filter-bar.js';
import {Summary} from './components/summary.js';
import {TransactionTable} from './components/transaction-table.js';
import {writeSetupMarker} from './setup-marker.js';
import {ConfirmScreen} from './screens/confirm-screen.js';
import {DeleteScreen} from './screens/delete-screen.js';
import {SetupScreen} from './screens/setup-screen.js';
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
  | {name: 'error'; message: string};

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
  return error.issues
    .map((issue) => {
      const source = issue.source === 'settings' ? '設定' : '交易';
      const row = issue.row === undefined ? '' : ` / 第 ${issue.row} 列`;
      return `${source}${row} / ${issue.field}：${issue.message}`;
    })
    .join('\n');
}

function mutationErrorMessage(error: unknown): string {
  if (error instanceof SourceConflictError) {
    return '檔案已被外部修改。請重新載入後再試。';
  }
  if (error instanceof LedgerValidationError) return issueMessage(error);
  return '無法儲存交易，請確認檔案權限後再試一次。';
}

function RecoveryApp({
  inspection,
  onExit,
}: RecoveryAppProps & {onExit(): void}) {
  useInput((input) => {
    if (input === 'q') onExit();
  });

  return (
    <Box flexDirection="column">
      <Text bold>班費帳本</Text>
      <Text color="yellow">資料目前只能讀取，請先處理以下問題：</Text>
      {inspection.issues.map((issue, index) => (
        <Text key={`${issue.source}-${issue.field}-${index}`}>
          {issue.source === 'settings' ? '設定' : '交易'} / {issue.field}：
          {issue.message}
        </Text>
      ))}
    </Box>
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
  const [filter] = useState<LedgerFilter>(() => ({...emptyFilter}));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [formToday, setFormToday] = useState('');
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
    return <RecoveryApp inspection={props.inspection} onExit={props.onExit} />;
  }

  return <ReadyApp {...props} />;
}
