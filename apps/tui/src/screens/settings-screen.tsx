import {useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';

import {
  addOption,
  archiveOption,
  deleteSemester,
  isSemesterLocked,
  LedgerValidationError,
  moveSemester,
  setActiveSemester,
  setDefaultOfficer,
  setSemesterLocked,
  SourceConflictError,
  type LedgerOption,
  type LedgerSettings,
  type LedgerState,
  type OptionGroup,
  type SemesterMoveDirection,
} from '@class-fund/ledger';

import {ModalFrame} from '../components/modal-frame.js';

export interface SettingsSavedOptions {
  stayOpen?: boolean;
}

export interface SettingsScreenProps {
  state: LedgerState;
  onSave(settings: LedgerSettings): Promise<void>;
  onCancel(): void;
  onSaved?(
    settings: LedgerSettings,
    options?: SettingsSavedOptions,
  ): void;
}

interface PersistOptions {
  stayOpen?: boolean;
  successMessage?: string;
}

type Action =
  | 'semester'
  | 'officer'
  | 'add-semester'
  | 'add-officer'
  | 'add-category'
  | 'semester-lock'
  | 'archive-semester'
  | 'archive-category'
  | 'archive-officer'
  | 'reorder-semester'
  | 'delete-semester';

type AddAction = Extract<Action, `add-${string}`>;

const actions: Array<{label: string; value: Action}> = [
  {label: '目前學期', value: 'semester'},
  {label: '預設經手人', value: 'officer'},
  {label: '新增學期', value: 'add-semester'},
  {label: '新增經手人', value: 'add-officer'},
  {label: '新增分類', value: 'add-category'},
  {label: '學期鎖定狀態', value: 'semester-lock'},
  {label: '封存學期', value: 'archive-semester'},
  {label: '封存分類', value: 'archive-category'},
  {label: '封存經手人', value: 'archive-officer'},
  {label: '調整學期順序', value: 'reorder-semester'},
  {label: '永久刪除學期', value: 'delete-semester'},
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

function semesterManagementLabel(
  settings: LedgerSettings,
  option: LedgerOption,
): string {
  const statuses: string[] = [];
  if (option.status === 'active') statuses.push('啟用中');
  else statuses.push('已封存');
  if (option.value === settings.active_semester) statuses.push('目前學期');
  if (isSemesterLocked(settings, option.value)) statuses.push('已鎖定');
  return `${option.value}（${statuses.join('／')}）`;
}

function semesterMoveItems(
  settings: LedgerSettings,
  value: string,
): Array<{label: string; value: SemesterMoveDirection}> {
  const index = settings.semesters.findIndex(
    (semester) => semester.value === value,
  );
  if (index === -1 || isSemesterLocked(settings, value)) return [];

  const items: Array<{label: string; value: SemesterMoveDirection}> = [];
  const previous = settings.semesters[index - 1];
  const next = settings.semesters[index + 1];
  if (previous !== undefined && !isSemesterLocked(settings, previous.value)) {
    items.push({label: '往前移', value: 'earlier'});
  }
  if (next !== undefined && !isSemesterLocked(settings, next.value)) {
    items.push({label: '往後移', value: 'later'});
  }
  return items;
}

function validationMessage(
  error: LedgerValidationError,
  action: Action,
): string {
  const messages = error.issues.map((issue) => issue.message);
  if (messages.includes('Active semester cannot be archived')) {
    return '目前學期不可封存';
  }
  if (messages.includes('Active semester cannot be locked')) {
    return '目前學期不可鎖定';
  }
  if (messages.includes('Locked semester cannot become active')) {
    return '已鎖定學期不可設為目前學期';
  }
  if (messages.includes('Locked semester cannot be archived')) {
    return '已鎖定學期不可封存，請先解鎖';
  }
  if (messages.includes('Locked semester cannot be reordered')) {
    return '已鎖定學期不可調整順序，請先解鎖';
  }
  if (messages.includes('Semester cannot move beyond configured order')) {
    return '此學期目前沒有可移動的位置';
  }
  if (messages.includes('Semester confirmation does not match')) {
    return '輸入名稱不符，未刪除學期';
  }
  if (messages.includes('Current semester cannot be deleted')) {
    return '目前學期不可刪除';
  }
  if (messages.includes('Locked semester cannot be deleted')) {
    return '已鎖定學期不可刪除，請先解鎖';
  }
  if (messages.includes('Referenced semester cannot be deleted')) {
    return '此學期仍有交易，請先移動或刪除交易';
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
  const [selectedSemester, setSelectedSemester] = useState<string | null>(null);
  const [optionValue, setOptionValue] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  useInput(
    (_input, key) => {
      if (!key.escape || pendingRef.current) return;
      if (action === null) onCancel();
      else if (selectedSemester !== null) {
        setSelectedSemester(null);
        setOptionValue('');
        setMessage(null);
      } else {
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
    options: PersistOptions = {},
  ): Promise<boolean> {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setMessage(null);
    try {
      await onSave(next);
      setMessage(options.successMessage ?? '設定已儲存');
      if (options.stayOpen === true) {
        onSaved?.(next, {stayOpen: true});
      } else {
        onSaved?.(next);
      }
      return true;
    } catch (error) {
      if (error instanceof SourceConflictError) {
        setMessage('檔案已被外部修改。請重新載入後再試。');
      } else if (error instanceof LedgerValidationError) {
        setMessage(validationMessage(error, selectedAction));
      } else {
        setMessage('無法儲存設定，請確認檔案權限後再試。');
      }
      return false;
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
        case 'semester-lock':
          next = setSemesterLocked(
            state,
            value,
            !isSemesterLocked(state.settings, value),
          );
          break;
        case 'officer':
          next = setDefaultOfficer(state, value);
          break;
        case 'add-semester':
        case 'add-officer':
        case 'add-category':
          next = addOption(state, addOptionGroups[action], value);
          break;
        case 'reorder-semester':
        case 'delete-semester':
          return;
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

  async function proposeSemesterMove(
    direction: SemesterMoveDirection,
  ): Promise<void> {
    if (selectedSemester === null) return;
    try {
      const next = moveSemester(state, selectedSemester, direction);
      const saved = await persist(next, 'reorder-semester', {
        stayOpen: true,
        successMessage: '學期順序已儲存',
      });
      if (saved) setSelectedSemester(null);
    } catch (error) {
      setMessage(
        error instanceof LedgerValidationError
          ? validationMessage(error, 'reorder-semester')
          : '設定內容無效，請檢查選擇或輸入值',
      );
    }
  }

  async function proposeSemesterDelete(): Promise<void> {
    if (selectedSemester === null || pendingRef.current) return;
    try {
      const next = deleteSemester(state, selectedSemester, optionValue);
      const saved = await persist(next, 'delete-semester', {
        stayOpen: true,
        successMessage: '學期已永久刪除',
      });
      if (saved) {
        setSelectedSemester(null);
        setOptionValue('');
      }
    } catch (error) {
      setMessage(
        error instanceof LedgerValidationError
          ? validationMessage(error, 'delete-semester')
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
  } else if (action === 'reorder-semester') {
    if (selectedSemester === null) {
      content = (
        <SelectInput
          key={action}
          isFocused={!pending}
          items={state.settings.semesters.map((option) => ({
            label: semesterManagementLabel(state.settings, option),
            value: option.value,
          }))}
          onSelect={(item) => {
            setMessage(null);
            if (isSemesterLocked(state.settings, item.value)) {
              setMessage('已鎖定學期不可調整順序，請先解鎖');
              return;
            }
            setSelectedSemester(item.value);
          }}
        />
      );
    } else {
      const moveItems = semesterMoveItems(state.settings, selectedSemester);
      content =
        moveItems.length === 0 ? (
          <Text>此學期目前沒有可移動的位置</Text>
        ) : (
          <SelectInput
            key={`${action}:${selectedSemester}`}
            isFocused={!pending}
            items={moveItems}
            onSelect={(item) => void proposeSemesterMove(item.value)}
          />
        );
    }
  } else if (action === 'delete-semester') {
    if (selectedSemester === null) {
      content = (
        <SelectInput
          key={action}
          isFocused={!pending}
          items={state.settings.semesters.map((option) => ({
            label: semesterManagementLabel(state.settings, option),
            value: option.value,
          }))}
          onSelect={(item) => {
            setMessage(null);
            setOptionValue('');
            setSelectedSemester(item.value);
          }}
        />
      );
    } else {
      content = (
        <Box flexDirection="column">
          <Text color="red">永久刪除後無法復原</Text>
          <Text>{`請輸入「${selectedSemester}」確認永久刪除`}</Text>
          <TextInput
            value={optionValue}
            focus={!pending}
            onChange={(value) => {
              setMessage(null);
              setOptionValue(value);
            }}
            onSubmit={() => void proposeSemesterDelete()}
          />
        </Box>
      );
    }
  } else {
    const options =
      action === 'semester'
        ? activeOptions(state.settings.semesters).filter(
            (option) => !isSemesterLocked(state.settings, option.value),
          )
        : action === 'semester-lock' || action === 'archive-semester'
          ? activeOptions(state.settings.semesters)
        : action === 'officer' || action === 'archive-officer'
          ? activeOptions(state.settings.officers)
          : activeOptions(state.settings.categories);
    content = (
      <SelectInput
        key={action}
        isFocused={!pending}
        items={options.map((option) => ({
          label:
            action === 'semester-lock'
              ? `${option.value}（${
                  isSemesterLocked(state.settings, option.value)
                    ? '已鎖定'
                    : '未鎖定'
                }）`
              : option.value,
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
        <Text
          color={
            message === '設定已儲存' ||
            message === '學期順序已儲存' ||
            message === '學期已永久刪除'
              ? 'green'
              : 'red'
          }
        >
          {message}
        </Text>
      )}
      <Text>Esc 返回</Text>
    </ModalFrame>
  );
}
