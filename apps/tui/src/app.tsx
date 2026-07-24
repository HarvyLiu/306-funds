import {useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';

import {
  createLedgerView,
  emptyFilter,
  type LedgerFilter,
  type LedgerSettings,
  type LedgerState,
} from '@class-fund/ledger';
import type {LedgerInspection, LedgerRepository} from '@class-fund/ledger/node';

import {CommandBar} from './components/command-bar.js';
import {FilterBar} from './components/filter-bar.js';
import {Summary} from './components/summary.js';
import {TransactionTable} from './components/transaction-table.js';
import {writeSetupMarker} from './setup-marker.js';
import {SetupScreen} from './screens/setup-screen.js';

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

export type Screen = {name: 'overview'} | {name: 'setup'};

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
}: AppProps & ReadyAppProps) {
  const [screen, setScreen] = useState<Screen>(() =>
    setupComplete ? {name: 'overview'} : {name: 'setup'},
  );
  const [state, setState] = useState<LedgerState>(() => repository.getState());
  const [setupError, setSetupError] = useState<string | null>(null);
  const [filter] = useState<LedgerFilter>(() => ({...emptyFilter}));
  const [selectedIndex, setSelectedIndex] = useState(0);
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
      if (key.downArrow || input === 'j') {
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

function isReadyApp(props: AppProps): props is AppProps & ReadyAppProps {
  return props.repository !== undefined;
}

export function App(props: AppProps) {
  if (!isReadyApp(props)) {
    return <RecoveryApp inspection={props.inspection} onExit={props.onExit} />;
  }

  return <ReadyApp {...props} />;
}
