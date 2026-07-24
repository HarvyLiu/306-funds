import {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';

import {
  createLedgerView,
  formatTwd,
  type LedgerFilter,
  type LedgerState,
} from '@class-fund/ledger';
import type {LedgerRepository} from '@class-fund/ledger/node';

import {ModalFrame} from '../components/modal-frame.js';

export interface CheckScreenProps {
  repository: LedgerRepository;
  filter: LedgerFilter;
  onFailure(error: unknown): void;
  onCancel(): void;
}

export function CheckScreen({
  repository,
  filter,
  onFailure,
  onCancel,
}: CheckScreenProps) {
  const [state, setState] = useState<LedgerState | null>(null);

  useInput(
    (_input, key) => {
      if (key.escape || key.return) onCancel();
    },
    {isActive: state !== null},
  );

  useEffect(() => {
    let active = true;
    void repository.reload().then(
      () => {
        if (active) setState(repository.getState());
      },
      (error: unknown) => {
        if (active) onFailure(error);
      },
    );
    return () => {
      active = false;
    };
  }, [onFailure, repository]);

  if (state === null) {
    return (
      <ModalFrame title="發布前資料檢查">
        <Text>正在重新載入並檢查資料…</Text>
      </ModalFrame>
    );
  }

  const view = createLedgerView(state.transactions, filter);
  return (
    <ModalFrame title="發布前資料檢查">
      <Text color="green" bold>
        資料檢查通過
      </Text>
      <Text>交易筆數 {state.transactions.length}</Text>
      <Text>總收入 {formatTwd(view.overall.income)}</Text>
      <Text>總支出 {formatTwd(view.overall.expenses)}</Text>
      <Text>目前總餘額 {formatTwd(view.overall.net)}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>篩選收入 {formatTwd(view.filtered.income)}</Text>
        <Text>篩選支出 {formatTwd(view.filtered.expenses)}</Text>
        <Text>篩選淨額 {formatTwd(view.filtered.net)}</Text>
      </Box>
      <Text>按 Enter 或 Esc 返回</Text>
    </ModalFrame>
  );
}
