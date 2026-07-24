import {useRef} from 'react';
import {Box, Text, useInput} from 'ink';

import {formatTwd, type Transaction} from '@class-fund/ledger';

import {ModalFrame} from '../components/modal-frame.js';

export interface DeleteScreenProps {
  transaction: Transaction;
  onConfirm(): void;
  onCancel(): void;
}

export function DeleteScreen({
  transaction,
  onConfirm,
  onCancel,
}: DeleteScreenProps) {
  const completed = useRef(false);

  useInput((input, key) => {
    if (completed.current) return;
    if (input.toLowerCase() === 'y') {
      completed.current = true;
      onConfirm();
    } else if (input.toLowerCase() === 'n' || key.escape) {
      completed.current = true;
      onCancel();
    }
  });

  return (
    <ModalFrame title="刪除交易">
      <Text>日期：{transaction.date}</Text>
      <Text>項目：{transaction.subject}</Text>
      <Text>分類：{transaction.category}</Text>
      <Text>類型：{transaction.type === 'income' ? '收入' : '支出'}</Text>
      <Text>金額：{formatTwd(transaction.amount)}</Text>
      <Text>經手人：{transaction.handled_by}</Text>
      <Text>學期：{transaction.semester}</Text>
      <Text>備註：{transaction.note}</Text>
      <Text>識別碼：{transaction.id}</Text>
      <Text>建立時間：{transaction.created_at}</Text>
      <Box marginTop={1}>
        <Text color="red">確定刪除？按 y 確認，n 或 Esc 取消</Text>
      </Box>
    </ModalFrame>
  );
}
