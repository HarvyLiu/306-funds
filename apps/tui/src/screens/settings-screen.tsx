import {useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';

import {
  addOption,
  archiveOption,
  LedgerValidationError,
  setActiveSemester,
  setDefaultOfficer,
  SourceConflictError,
  type LedgerOption,
  type LedgerSettings,
  type LedgerState,
  type OptionGroup,
} from '@class-fund/ledger';

import {ModalFrame} from '../components/modal-frame.js';

export interface SettingsScreenProps {
  state: LedgerState;
  onSave(settings: LedgerSettings): Promise<void>;
  onCancel(): void;
  onSaved?(settings: LedgerSettings): void;
}

type Action =
  | 'semester'
  | 'officer'
  | 'add-semester'
  | 'add-officer'
  | 'add-category'
  | 'archive-semester'
  | 'archive-category'
  | 'archive-officer';

type AddAction = Extract<Action, `add-${string}`>;

const actions: Array<{label: string; value: Action}> = [
  {label: '目前學期', value: 'semester'},
  {label: '預設經手人', value: 'officer'},
  {label: '新增學期', value: 'add-semester'},
  {label: '新增經手人', value: 'add-officer'},
  {label: '新增分類', value: 'add-category'},
  {label: '封存學期', value: 'archive-semester'},
  {label: '封存分類', value: 'archive-category'},
  {label: '封存經手人', value: 'archive-officer'},
];

const addOptionGroups: Record<AddAction, OptionGroup> = {
  'add-semester': 'semesters',
  'add-officer': 'officers',
  'add-category': 'categories',
};

function isAddAction(action: Action): action is AddAction {
  return action in addOptionGroups;
}

function activeOptions(options: readonly LedgerOption[]): LedgerOption[] {
  return options.filter((option) => option.status === 'active');
}

function validationMessage(
  error: LedgerValidationError,
  action: Action,
): string {
  const messages = error.issues.map((issue) => issue.message);
  if (messages.includes('Active semester cannot be archived')) {
    return '目前學期不可封存';
  }
  if (messages.includes('Default officer cannot be archived')) {
    return '預設經手人不可封存';
  }
  if (messages.includes('Referenced option cannot be archived')) {
    if (action === 'archive-category') return '此分類已被交易引用，無法封存';
    if (action === 'archive-semester') return '此學期已被交易引用，無法封存';
    return '此經手人已被交易引用，無法封存';
  }
  if (messages.includes('Option value is already configured')) {
    if (action === 'add-semester') return '此學期已存在';
    if (action === 'add-officer') return '此經手人已存在';
    return '此分類已存在';
  }
  return '設定內容無效，請檢查選擇或輸入值';
}

export function SettingsScreen({
  state,
  onSave,
  onCancel,
  onSaved,
}: SettingsScreenProps) {
  const [action, setAction] = useState<Action | null>(null);
  const [optionValue, setOptionValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  useInput(
    (_input, key) => {
      if (!key.escape || pendingRef.current) return;
      if (action === null) onCancel();
      else {
        setAction(null);
        setOptionValue('');
        setMessage(null);
      }
    },
    {isActive: !pending},
  );

  async function persist(
    next: LedgerSettings,
    selectedAction: Action,
  ): Promise<void> {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setMessage(null);
    try {
      await onSave(next);
      setMessage('設定已儲存');
      onSaved?.(next);
    } catch (error) {
      if (error instanceof SourceConflictError) {
        setMessage('檔案已被外部修改。請重新載入後再試。');
      } else if (error instanceof LedgerValidationError) {
        setMessage(validationMessage(error, selectedAction));
      } else {
        setMessage('無法儲存設定，請確認檔案權限後再試。');
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function propose(value: string): void {
    if (action === null) return;
    try {
      let next: LedgerSettings;
      switch (action) {
        case 'semester':
          next = setActiveSemester(state, value);
          break;
        case 'officer':
          next = setDefaultOfficer(state, value);
          break;
        case 'add-semester':
        case 'add-officer':
        case 'add-category':
          next = addOption(state, addOptionGroups[action], value);
          break;
        default: {
          const group: OptionGroup =
            action === 'archive-semester'
              ? 'semesters'
              : action === 'archive-category'
                ? 'categories'
                : 'officers';
          next = archiveOption(state, group, value);
        }
      }
      void persist(next, action);
    } catch (error) {
      setMessage(
        error instanceof LedgerValidationError
          ? validationMessage(error, action)
          : '設定內容無效，請檢查選擇或輸入值',
      );
    }
  }

  let content;
  if (action === null) {
    content = (
      <SelectInput
        items={actions}
        onSelect={(item) => {
          setMessage(null);
          setOptionValue('');
          setAction(item.value);
        }}
      />
    );
  } else if (isAddAction(action)) {
    content = (
      <TextInput
        value={optionValue}
        focus={!pending}
        onChange={(value) => {
          setMessage(null);
          setOptionValue(value);
        }}
        onSubmit={propose}
      />
    );
  } else {
    const options =
      action === 'semester' || action === 'archive-semester'
        ? activeOptions(state.settings.semesters)
        : action === 'officer' || action === 'archive-officer'
          ? activeOptions(state.settings.officers)
          : activeOptions(state.settings.categories);
    content = (
      <SelectInput
        key={action}
        isFocused={!pending}
        items={options.map((option) => ({
          label: option.value,
          value: option.value,
        }))}
        onSelect={(item) => propose(item.value)}
      />
    );
  }

  return (
    <ModalFrame title="帳本設定">
      <Box>{content}</Box>
      {pending ? <Text>正在儲存設定…</Text> : null}
      {message === null ? null : (
        <Text color={message === '設定已儲存' ? 'green' : 'red'}>{message}</Text>
      )}
      <Text>Esc 返回</Text>
    </ModalFrame>
  );
}
