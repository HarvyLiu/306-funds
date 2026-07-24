import {useRef} from 'react';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';

import {formatTwd} from '@class-fund/ledger';
import type {
  BackupInspection,
  LedgerInspection,
  SourceKind,
} from '@class-fund/ledger/node';

import {formatLedgerIssue} from '../ledger-issue.js';
import {ModalFrame} from '../components/modal-frame.js';

export interface RecoveryScreenProps {
  mode: 'issues' | 'select' | 'confirm';
  inspection?: LedgerInspection;
  preview?: BackupInspection;
  error?: string | null;
  pending?: 'reload' | 'inspect' | 'restore' | null;
  onReload(): void;
  onOpenSelection(): void;
  onSelect(kind: SourceKind): void;
  onRestore(): void;
  onCancel(): void;
  onExit(): void;
}

export function RecoveryScreen({
  mode,
  inspection,
  preview,
  error,
  pending = null,
  onReload,
  onOpenSelection,
  onSelect,
  onRestore,
  onCancel,
  onExit,
}: RecoveryScreenProps) {
  const actionScope = `${mode}:${pending ?? 'idle'}`;
  const action = useRef({scope: actionScope, accepted: false});
  if (action.current.scope !== actionScope) {
    action.current = {scope: actionScope, accepted: false};
  }

  useInput(
    (input, key) => {
      if (pending !== null || action.current.accepted) return;

      if (mode === 'issues') {
        if (input === 'l') {
          action.current.accepted = true;
          onReload();
        } else if (input === 'r') {
          action.current.accepted = true;
          onOpenSelection();
        } else if (input === 'q') {
          action.current.accepted = true;
          onExit();
        }
        return;
      }

      if (mode === 'select' && (input === '1' || input === '2')) {
        action.current.accepted = true;
        onSelect(input === '1' ? 'transactions' : 'settings');
        return;
      }

      if (mode === 'confirm' && input.toLowerCase() === 'y') {
        action.current.accepted = true;
        onRestore();
      } else if (key.escape) {
        action.current.accepted = true;
        onCancel();
      }
    },
  );

  if (mode === 'select') {
    return (
      <ModalFrame title="選擇備份">
        {pending === 'inspect' ? (
          <Text color="yellow">正在檢查備份…</Text>
        ) : (
          <>
            <SelectInput
              items={[
                {label: '交易備份', value: 'transactions' as const},
                {label: '設定備份', value: 'settings' as const},
              ]}
              onSelect={(item) => {
                if (action.current.accepted) return;
                action.current.accepted = true;
                onSelect(item.value);
              }}
            />
            <Text>Esc 取消</Text>
          </>
        )}
      </ModalFrame>
    );
  }

  if (mode === 'confirm' && preview !== undefined) {
    return (
      <ModalFrame title="備份預覽">
        <Text>
          來源 {preview.kind === 'transactions' ? '交易備份' : '設定備份'}
        </Text>
        <Text>交易筆數 {preview.transactions}</Text>
        <Text>總收入 {formatTwd(preview.totals.income)}</Text>
        <Text>總支出 {formatTwd(preview.totals.expenses)}</Text>
        <Text>目前總餘額 {formatTwd(preview.totals.net)}</Text>
        <Box marginTop={1}>
          {pending === 'restore' ? (
            <Text color="yellow">正在還原備份…</Text>
          ) : (
            <Text color="yellow">按 y 還原，Esc 取消</Text>
          )}
        </Box>
      </ModalFrame>
    );
  }

  return (
    <ModalFrame title="班費帳本 · 復原模式">
      <Text color="yellow">資料目前只能讀取，所有寫入功能已停用。</Text>
      {inspection?.issues.map((issue, index) => (
        <Box
          key={`${issue.source}-${issue.field}-${index}`}
          flexDirection="column"
        >
          <Text>{formatLedgerIssue(issue, true)}</Text>
        </Box>
      ))}
      {error === undefined || error === null ? null : (
        <Text color="red">{error}</Text>
      )}
      {pending === 'reload' ? (
        <Text color="yellow">正在重新載入…</Text>
      ) : (
        <Text>l 重新載入  r 還原備份  q 離開</Text>
      )}
    </ModalFrame>
  );
}
