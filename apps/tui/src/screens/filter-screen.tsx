import {useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';

import type {
  LedgerFilter,
  LedgerOption,
  LedgerSettings,
  Transaction,
  TransactionType,
} from '@class-fund/ledger';

import {ModalFrame} from '../components/modal-frame.js';

export interface FilterScreenProps {
  filter: LedgerFilter;
  settings: LedgerSettings;
  transactions: readonly Transaction[];
  mode: 'selectors' | 'search';
  onApply(filter: LedgerFilter): void;
  onCancel(): void;
}

type FilterStep = 'semester' | 'handledBy' | 'category' | 'type';

const steps: FilterStep[] = ['semester', 'handledBy', 'category', 'type'];
const labels: Record<FilterStep, string> = {
  semester: '學期',
  handledBy: '經手人',
  category: '分類',
  type: '類型',
};

function availableValues(
  options: readonly LedgerOption[],
  referencedValues: readonly string[],
): string[] {
  const referenced = new Set(referencedValues);
  return options
    .filter(
      (option) => option.status === 'active' || referenced.has(option.value),
    )
    .map((option) => option.value);
}

export function FilterScreen({
  filter,
  settings,
  transactions,
  mode,
  onApply,
  onCancel,
}: FilterScreenProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [draft, setDraft] = useState<LedgerFilter>(() => ({...filter}));

  useInput(
    (_input, key) => {
      if (key.escape) onCancel();
    },
    {isActive: true},
  );

  const values = useMemo(
    () => ({
      semester: availableValues(
        settings.semesters,
        transactions.map((transaction) => transaction.semester),
      ),
      handledBy: availableValues(
        settings.officers,
        transactions.map((transaction) => transaction.handled_by),
      ),
      category: availableValues(
        settings.categories,
        transactions.map((transaction) => transaction.category),
      ),
      type: ['income', 'expense'] as TransactionType[],
    }),
    [settings, transactions],
  );

  if (mode === 'search') {
    return (
      <ModalFrame title="搜尋交易">
        <Text>搜尋項目與備註</Text>
        <Box marginTop={1}>
          <TextInput
            value={draft.search}
            onChange={(search) => setDraft((current) => ({...current, search}))}
            onSubmit={(search) => onApply({...draft, search})}
          />
        </Box>
        <Text>Enter 套用，Esc 取消</Text>
      </ModalFrame>
    );
  }

  const step = steps[stepIndex]!;
  const stepValues = values[step];
  const currentValue = draft[step];
  const items = [
    {label: '全部', value: null},
    ...stepValues.map((value) => ({
      label:
        step === 'type'
          ? value === 'income'
            ? '收入'
            : '支出'
          : value,
      value,
    })),
  ];
  const initialIndex = Math.max(
    0,
    items.findIndex((item) => item.value === currentValue),
  );

  return (
    <ModalFrame title="篩選交易">
      <Text>
        步驟 {stepIndex + 1}/{steps.length}　{labels[step]}
      </Text>
      <Box marginTop={1}>
        <SelectInput
          key={step}
          items={items}
          initialIndex={initialIndex}
          onSelect={(item) => {
            const next = {...draft, [step]: item.value} as LedgerFilter;
            setDraft(next);
            if (stepIndex === steps.length - 1) {
              onApply(next);
            } else {
              setStepIndex((current) => current + 1);
            }
          }}
        />
      </Box>
      <Text>選擇「全部」可清除此項，Esc 取消</Text>
    </ModalFrame>
  );
}
