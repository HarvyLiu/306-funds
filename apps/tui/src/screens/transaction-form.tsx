import {useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';

import type {
  LedgerOption,
  LedgerSettings,
  TransactionInput,
  TransactionType,
} from '@class-fund/ledger';

import {ModalFrame} from '../components/modal-frame.js';

export interface TransactionFormProps {
  mode: 'add' | 'edit';
  settings: LedgerSettings;
  initialValue?: TransactionInput;
  today: string;
  onReview(input: TransactionInput): void;
  onCancel(): void;
}

type Step =
  | 'date'
  | 'subject'
  | 'category'
  | 'type'
  | 'amount'
  | 'handled_by'
  | 'semester'
  | 'note';

const steps: Step[] = [
  'date',
  'subject',
  'category',
  'type',
  'amount',
  'handled_by',
  'semester',
  'note',
];

const labels: Record<Step, string> = {
  date: '日期',
  subject: '項目',
  category: '分類',
  type: '類型',
  amount: '金額',
  handled_by: '經手人',
  semester: '學期',
  note: '備註',
};

interface FormValues {
  date: string;
  subject: string;
  category: string;
  type: TransactionType;
  amount: string;
  handled_by: string;
  semester: string;
  note: string;
}

function activeValue(options: readonly LedgerOption[]): string {
  return options.find((option) => option.status === 'active')?.value ?? '';
}

function initialValues(
  settings: LedgerSettings,
  today: string,
  initialValue?: TransactionInput,
): FormValues {
  if (initialValue !== undefined) {
    return {
      ...initialValue,
      amount: String(initialValue.amount),
    };
  }

  return {
    date: today,
    subject: '',
    category: activeValue(settings.categories),
    type: 'income',
    amount: '',
    handled_by: settings.default_officer,
    semester: settings.active_semester,
    note: '',
  };
}

function selectableOptions(
  options: readonly LedgerOption[],
  currentValue: string,
): LedgerOption[] {
  return options.filter(
    (option) => option.status === 'active' || option.value === currentValue,
  );
}

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function textError(step: Step, value: string): string | null {
  if (step === 'date') {
    return isRealDate(value) ? null : '請輸入有效日期（YYYY-MM-DD）';
  }
  if (step === 'subject') {
    if (value.length === 0) return '項目不可空白';
    if (value.trim() !== value) return '項目前後不可有空格';
  }
  if (step === 'amount') {
    if (!/^[1-9]\d*$/.test(value)) return '金額必須是正整數';
    const amount = Number(value);
    if (!Number.isSafeInteger(amount)) return '金額必須是正整數';
  }
  if (step === 'note' && /\r|\n/.test(value)) {
    return '備註只能輸入單行文字';
  }
  if (/[^\n\r\t\u0020-\u007e\u00a0-\uffff]/u.test(value)) {
    return '內容含有不允許的控制字元';
  }
  return null;
}

function transactionInput(values: FormValues): TransactionInput {
  return {
    date: values.date,
    semester: values.semester,
    subject: values.subject,
    category: values.category,
    type: values.type,
    amount: Number(values.amount),
    handled_by: values.handled_by,
    note: values.note,
  };
}

export function TransactionForm({
  mode,
  settings,
  initialValue,
  today,
  onReview,
  onCancel,
}: TransactionFormProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<FormValues>(() =>
    initialValues(settings, today, initialValue),
  );
  const [error, setError] = useState<string | null>(null);
  const step = steps[stepIndex]!;

  useInput((_input, key) => {
    if (key.escape) onCancel();
  });

  const categoryOptions = useMemo(
    () => selectableOptions(settings.categories, values.category),
    [settings.categories, values.category],
  );
  const officerOptions = useMemo(
    () => selectableOptions(settings.officers, values.handled_by),
    [settings.officers, values.handled_by],
  );
  const semesterOptions = useMemo(
    () => selectableOptions(settings.semesters, values.semester),
    [settings.semesters, values.semester],
  );
  const isBlocked = step === 'category' && categoryOptions.length === 0;

  function setValue<Key extends keyof FormValues>(
    field: Key,
    value: FormValues[Key],
  ): void {
    setError(null);
    setValues((current) => ({...current, [field]: value}));
  }

  function advance(): void {
    if (stepIndex === steps.length - 1) {
      onReview(transactionInput(values));
      return;
    }
    setError(null);
    setStepIndex((current) => current + 1);
  }

  function submitText(value: string): void {
    const invalid = textError(step, value);
    if (invalid !== null) {
      setError(invalid);
      return;
    }
    advance();
  }

  function optionList(
    options: readonly LedgerOption[],
    field: 'category' | 'handled_by' | 'semester',
  ) {
    if (options.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color="yellow">目前沒有可用的分類</Text>
          <Text>請先到設定新增或啟用分類，或按 Esc 取消</Text>
        </Box>
      );
    }

    const initialIndex = Math.max(
      0,
      options.findIndex((option) => option.value === values[field]),
    );
    return (
      <SelectInput
        key={step}
        items={options.map((option) => ({
          label: option.value,
          value: option.value,
        }))}
        initialIndex={initialIndex}
        onSelect={(item) => {
          setValue(field, item.value);
          advance();
        }}
      />
    );
  }

  function currentInput() {
    switch (step) {
      case 'date':
      case 'subject':
      case 'amount':
      case 'note':
        return (
          <TextInput
            value={values[step]}
            onChange={(value) => setValue(step, value)}
            onSubmit={submitText}
          />
        );
      case 'category':
        return optionList(categoryOptions, 'category');
      case 'handled_by':
        return optionList(officerOptions, 'handled_by');
      case 'semester':
        return optionList(semesterOptions, 'semester');
      case 'type': {
        const types = [
          {label: '收入', value: 'income' as const},
          {label: '支出', value: 'expense' as const},
        ];
        return (
          <SelectInput
            key={step}
            items={types}
            initialIndex={values.type === 'expense' ? 1 : 0}
            onSelect={(item) => {
              setValue('type', item.value);
              advance();
            }}
          />
        );
      }
    }
  }

  return (
    <ModalFrame title={mode === 'add' ? '新增交易' : '編輯交易'}>
      <Text>
        步驟 {stepIndex + 1}/{steps.length}　{labels[step]}
      </Text>
      <Box marginTop={1}>{currentInput()}</Box>
      <Box marginTop={1}>
        {isBlocked ? (
          <Text>Esc 取消</Text>
        ) : error === null ? (
          <Text>Enter 繼續，Esc 取消</Text>
        ) : (
          <Text color="red">{error}</Text>
        )}
      </Box>
    </ModalFrame>
  );
}
