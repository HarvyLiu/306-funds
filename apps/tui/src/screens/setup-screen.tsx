import {useEffect, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';

import {
  validateSettingsValue,
  type LedgerOption,
  type LedgerSettings,
  type Transaction,
} from '@class-fund/ledger';

import {ModalFrame} from '../components/modal-frame.js';

const genericSemesters = new Set(['第一學期', '第二學期']);
const genericOfficers = new Set(['我', '另一位總務']);

interface SetupScreenProps {
  settings: LedgerSettings;
  transactions: readonly Transaction[];
  onSubmit(settings: LedgerSettings): void | Promise<void>;
  onCancel?(): void;
  error?: string | null;
}

type Step = 0 | 1 | 2;

const labels = ['目前學期', '目前總務', '另一位總務'] as const;

function replaceGenericOptions(
  options: readonly LedgerOption[],
  genericValues: ReadonlySet<string>,
  referencedValues: ReadonlySet<string>,
  enteredValues: readonly string[],
): LedgerOption[] {
  const entered = new Set(enteredValues);
  const result: LedgerOption[] = [];

  for (const option of options) {
    if (entered.has(option.value)) {
      continue;
    }
    if (genericValues.has(option.value)) {
      if (referencedValues.has(option.value)) {
        result.push({value: option.value, status: 'archived'});
      }
      continue;
    }
    result.push({...option});
  }

  for (const value of enteredValues) {
    if (!result.some((option) => option.value === value)) {
      result.push({value, status: 'active'});
    }
  }

  return result;
}

function createSetupSettings(
  settings: LedgerSettings,
  transactions: readonly Transaction[],
  semester: string,
  defaultOfficer: string,
  otherOfficer: string,
): LedgerSettings {
  const referencedSemesters = new Set(
    transactions.map((transaction) => transaction.semester),
  );
  const referencedOfficers = new Set(
    transactions.map((transaction) => transaction.handled_by),
  );

  return validateSettingsValue({
    ...structuredClone(settings),
    active_semester: semester,
    default_officer: defaultOfficer,
    semesters: replaceGenericOptions(
      settings.semesters,
      genericSemesters,
      referencedSemesters,
      [semester],
    ),
    categories: settings.categories.map((option) => ({...option})),
    officers: replaceGenericOptions(
      settings.officers,
      genericOfficers,
      referencedOfficers,
      [defaultOfficer, otherOfficer],
    ),
  });
}

function initialOtherOfficer(settings: LedgerSettings): string {
  return (
    settings.officers.find(
      (option) =>
        option.status === 'active' && option.value !== settings.default_officer,
    )?.value ?? ''
  );
}

function inputError(label: (typeof labels)[number], value: string): string | null {
  if (value.length === 0) {
    return `${label === '目前學期' ? '學期' : '姓名'}不可空白`;
  }
  if (value.trim() !== value) {
    return `${label === '目前學期' ? '學期' : '姓名'}前後不可有空格`;
  }
  return null;
}

export function SetupScreen({
  settings,
  transactions,
  onSubmit,
  onCancel,
  error: externalError,
}: SetupScreenProps) {
  const [step, setStep] = useState<Step>(0);
  const [values, setValues] = useState<[string, string, string]>([
    settings.active_semester,
    settings.default_officer,
    initialOtherOfficer(settings),
  ]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  useInput(
    (_input, key) => {
      if (key.escape) onCancel?.();
    },
    {isActive: onCancel !== undefined && !isSubmitting},
  );

  const value = values[step];
  const label = labels[step];

  function changeValue(next: string): void {
    setValidationError(null);
    setValues((current) => {
      const copy = [...current] as [string, string, string];
      copy[step] = next;
      return copy;
    });
  }

  function submitStep(next: string): void {
    if (isSubmittingRef.current) return;

    const invalid = inputError(label, next);
    if (invalid !== null) {
      setValidationError(invalid);
      return;
    }

    if (step < 2) {
      setValidationError(null);
      setStep((step + 1) as Step);
      return;
    }

    if (values[1] === next) {
      setValidationError('兩位總務的姓名不可相同');
      return;
    }

    let nextSettings: LedgerSettings;
    try {
      nextSettings = createSetupSettings(
        settings,
        transactions,
        values[0],
        values[1],
        next,
      );
    } catch {
      setValidationError('初始設定內容無效，請檢查輸入值');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setValidationError(null);

    try {
      void Promise.resolve(onSubmit(nextSettings)).then(
        () => {
          isSubmittingRef.current = false;
          if (!isMountedRef.current) return;
          setIsSubmitting(false);
        },
        () => {
          isSubmittingRef.current = false;
          if (!isMountedRef.current) return;
          setIsSubmitting(false);
          setValidationError('無法送出初始設定，請再試一次');
        },
      );
    } catch {
      isSubmittingRef.current = false;
      if (!isMountedRef.current) return;
      setIsSubmitting(false);
      setValidationError('無法送出初始設定，請再試一次');
    }
  }

  useInput((_input, key) => {
    if (key.return && !isSubmittingRef.current) {
      submitStep(value);
    }
  });

  return (
    <ModalFrame title="初始設定">
      <Text>步驟 {step + 1}/3</Text>
      <Box marginTop={1}>
        <Text>{label}： </Text>
        <TextInput
          key={`${step}-${isSubmitting ? 'submitting' : 'editing'}`}
          value={value}
          onChange={changeValue}
          focus={!isSubmitting}
        />
      </Box>
      <Box marginTop={1}>
        {isSubmitting ? (
          <Text>正在儲存初始設定…</Text>
        ) : validationError ?? externalError ? (
          <Text color="red">{validationError ?? externalError}</Text>
        ) : (
          <Text>輸入後按 Enter 繼續</Text>
        )}
      </Box>
    </ModalFrame>
  );
}
