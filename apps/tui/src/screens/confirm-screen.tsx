import {useRef} from 'react';
import {Box, Text, useInput} from 'ink';

import {formatTwd, type MutationPreview} from '@class-fund/ledger';

import {ModalFrame} from '../components/modal-frame.js';

const fieldLabels: Record<keyof MutationPreview['target'], string> = {
  id: '識別碼',
  date: '日期',
  semester: '學期',
  subject: '項目',
  category: '分類',
  type: '類型',
  amount: '金額',
  handled_by: '經手人',
  note: '備註',
  created_at: '建立時間',
};

export interface ConfirmScreenProps {
  preview: MutationPreview;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmScreen({
  preview,
  onConfirm,
  onCancel,
}: ConfirmScreenProps) {
  const completed = useRef(false);
  const {target} = preview;

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
    <ModalFrame title="確認交易">
      <Text>日期：{target.date}</Text>
      <Text>項目：{target.subject}</Text>
      <Text>分類：{target.category}</Text>
      <Text>類型：{target.type === 'income' ? '收入' : '支出'}</Text>
      <Text>金額：{formatTwd(target.amount)}</Text>
      <Text>經手人：{target.handled_by}</Text>
      <Text>學期：{target.semester}</Text>
      <Text>備註：{target.note}</Text>
      {preview.kind === 'edit' ? (
        <Text>
          變更欄位：
          {preview.changedFields.length === 0
            ? '無'
            : preview.changedFields.map((field) => fieldLabels[field]).join('、')}
        </Text>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text>儲存後餘額：{formatTwd(preview.resultingBalance)}</Text>
        {preview.createsNegativeBalance ? (
          <Text color="yellow">警告：儲存後餘額為負數</Text>
        ) : null}
        <Text color="yellow">項目與備註內容將公開</Text>
      </Box>
      <Box marginTop={1}>
        <Text>按 y 確認，n 或 Esc 取消</Text>
      </Box>
    </ModalFrame>
  );
}
