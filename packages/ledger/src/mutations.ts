import {calculateTotals} from './calculations.js';
import {
  parseTransactionsCsv,
  serializeTransactionsCsv,
  TRANSACTION_HEADERS,
} from './csv.js';
import {LedgerValidationError} from './errors.js';
import {validateSettingsValue} from './settings.js';
import type {
  LedgerIssue,
  LedgerSettings,
  LedgerState,
  MutationPreview,
  OptionGroup,
  SemesterMoveDirection,
  Transaction,
  TransactionInput,
} from './types.js';

export interface MutationDependencies {
  createId(): string;
  now(): string;
}

interface CanonicalLedgerState {
  settings: LedgerSettings;
  transactions: Transaction[];
}

const GROUP_REFERENCE_FIELDS: Record<
  OptionGroup,
  'semester' | 'category' | 'handled_by'
> = {
  semesters: 'semester',
  categories: 'category',
  officers: 'handled_by',
};

const ALL_TRANSACTION_FIELDS: Array<keyof Transaction> = [
  ...TRANSACTION_HEADERS,
];

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function formatLocalTimestamp(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetRemainder = absoluteOffset % 60;

  return [
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
    `${offsetSign}${pad(offsetHours)}:${pad(offsetRemainder)}`,
  ].join('');
}

const defaultDependencies: MutationDependencies = {
  createId: () => globalThis.crypto.randomUUID().toLowerCase(),
  now: () => formatLocalTimestamp(new Date()),
};

function cloneTransaction(transaction: Transaction): Transaction {
  return {
    id: transaction.id,
    date: transaction.date,
    semester: transaction.semester,
    subject: transaction.subject,
    category: transaction.category,
    type: transaction.type,
    amount: transaction.amount,
    handled_by: transaction.handled_by,
    note: transaction.note,
    created_at: transaction.created_at,
  };
}

function transactionFromInput(
  input: TransactionInput,
  semester: unknown,
  id: string,
  createdAt: string,
): Transaction {
  let transaction: Transaction | undefined;
  let inspectionFailed = false;

  try {
    transaction = {
      id,
      date: input.date,
      semester: semester as string,
      subject: input.subject,
      category: input.category,
      type: input.type,
      amount: input.amount,
      handled_by: input.handled_by,
      note: input.note,
      created_at: createdAt,
    };
  } catch {
    inspectionFailed = true;
  }

  if (inspectionFailed || transaction === undefined) {
    transactionFailure('$', 'Transaction input could not be inspected');
  }

  return transaction;
}

function validationFailure(issue: LedgerIssue): never {
  throw new LedgerValidationError([issue]);
}

function settingsFailure(field: string, message: string): never {
  validationFailure({source: 'settings', field, message});
}

function transactionFailure(
  field: string,
  message: string,
  row?: number,
): never {
  validationFailure({
    source: 'transactions',
    ...(row === undefined ? {} : {row}),
    field,
    message,
  });
}

function lockedSemesterTransactionFailure(row?: number): never {
  transactionFailure(
    'semester',
    'Locked semester transactions cannot be modified',
    row,
  );
}

export function isSemesterLocked(
  settings: LedgerSettings,
  semester: string,
): boolean {
  return settings.locked_semesters.includes(semester);
}

function snapshotInputSemester(
  input: TransactionInput,
): unknown {
  try {
    return input.semester;
  } catch {
    transactionFailure('$', 'Transaction input could not be inspected');
  }
}

function rejectLockedInputSemester(
  settings: LedgerSettings,
  semester: unknown,
  row: number,
): void {
  if (typeof semester === 'string' && isSemesterLocked(settings, semester)) {
    lockedSemesterTransactionFailure(row);
  }
}

function isOptionGroup(value: unknown): value is OptionGroup {
  return (
    value === 'semesters' || value === 'categories' || value === 'officers'
  );
}

function requireOptionGroup(value: OptionGroup): OptionGroup {
  if (!isOptionGroup(value)) {
    settingsFailure('group', 'Option group is not supported');
  }

  return value;
}

function snapshotTransactionCandidate(candidate: unknown): unknown {
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate)
  ) {
    return candidate;
  }

  const record = candidate as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};

  for (const field of TRANSACTION_HEADERS) {
    snapshot[field] = record[field];
  }

  return snapshot;
}

function snapshotTransactionList(value: unknown): unknown[] {
  let snapshots: unknown[] = [];
  let inspectionFailed = false;

  try {
    if (!Array.isArray(value)) {
      inspectionFailed = true;
    } else {
      const length = value.length;
      for (let index = 0; index < length; index += 1) {
        snapshots.push(snapshotTransactionCandidate(value[index]));
      }
    }
  } catch {
    inspectionFailed = true;
    snapshots = [];
  }

  if (inspectionFailed) {
    transactionFailure('$', 'Transactions could not be inspected');
  }

  return snapshots;
}

function canonicalizeTransactions(
  value: unknown,
  settings: LedgerSettings,
): Transaction[] {
  const snapshots = snapshotTransactionList(value);
  const serialized = serializeTransactionsCsv(
    snapshots as Transaction[],
    settings,
  );

  return parseTransactionsCsv(serialized, settings);
}

function canonicalizeState(state: LedgerState): CanonicalLedgerState {
  const settings = validateSettingsValue(state.settings);
  let transactionsValue: unknown;
  let inspectionFailed = false;

  try {
    transactionsValue = state.transactions;
  } catch {
    inspectionFailed = true;
  }

  if (inspectionFailed) {
    transactionFailure('$', 'Transactions could not be inspected');
  }

  return {
    settings,
    transactions: canonicalizeTransactions(transactionsValue, settings),
  };
}

function mutationPreview(
  kind: MutationPreview['kind'],
  nextTransactions: Transaction[],
  target: Transaction,
  changedFields: Array<keyof Transaction>,
): MutationPreview {
  const resultingBalance = calculateTotals(nextTransactions).net;

  return {
    kind,
    nextTransactions,
    resultingBalance,
    createsNegativeBalance: resultingBalance < 0,
    changedFields: [...changedFields],
    target: cloneTransaction(target),
  };
}

function transactionIndex(transactions: Transaction[], id: string): number {
  let targetIndex = -1;

  transactions.forEach((transaction, index) => {
    if (transaction.id !== id) return;
    if (targetIndex !== -1) {
      transactionFailure('id', 'Transaction target is ambiguous');
    }
    targetIndex = index;
  });

  if (targetIndex === -1) {
    transactionFailure('id', 'Transaction was not found');
  }

  return targetIndex;
}

export function previewAdd(
  state: LedgerState,
  input: TransactionInput,
  dependencies: MutationDependencies = defaultDependencies,
): MutationPreview {
  const current = canonicalizeState(state);
  const inputSemester = snapshotInputSemester(input);
  rejectLockedInputSemester(
    current.settings,
    inputSemester,
    current.transactions.length + 2,
  );
  const targetCandidate = transactionFromInput(
    input,
    inputSemester,
    dependencies.createId(),
    dependencies.now(),
  );
  const nextTransactions = canonicalizeTransactions(
    [...current.transactions, targetCandidate],
    current.settings,
  );
  const target = nextTransactions.at(-1);
  if (target === undefined) {
    transactionFailure('$', 'Added transaction could not be resolved');
  }
  if (isSemesterLocked(current.settings, target.semester)) {
    lockedSemesterTransactionFailure(current.transactions.length + 2);
  }

  return mutationPreview(
    'add',
    nextTransactions,
    target,
    ALL_TRANSACTION_FIELDS,
  );
}

export function previewEdit(
  state: LedgerState,
  id: string,
  input: TransactionInput,
): MutationPreview {
  const current = canonicalizeState(state);
  const index = transactionIndex(current.transactions, id);
  const original = current.transactions[index];
  if (original === undefined) {
    transactionFailure('id', 'Transaction was not found');
  }
  if (isSemesterLocked(current.settings, original.semester)) {
    lockedSemesterTransactionFailure(index + 2);
  }
  const inputSemester = snapshotInputSemester(input);
  rejectLockedInputSemester(current.settings, inputSemester, index + 2);

  const targetCandidate = transactionFromInput(
    input,
    inputSemester,
    original.id,
    original.created_at,
  );
  const proposedTransactions = current.transactions.map(
    (transaction, rowIndex) =>
      rowIndex === index ? targetCandidate : transaction,
  );
  const nextTransactions = canonicalizeTransactions(
    proposedTransactions,
    current.settings,
  );
  const target = nextTransactions[index];
  if (target === undefined) {
    transactionFailure('$', 'Edited transaction could not be resolved');
  }
  if (isSemesterLocked(current.settings, target.semester)) {
    lockedSemesterTransactionFailure(index + 2);
  }
  const changedFields = ALL_TRANSACTION_FIELDS.filter(
    (field) => original[field] !== target[field],
  );

  return mutationPreview(
    'edit',
    nextTransactions,
    target,
    changedFields,
  );
}

export function previewDelete(
  state: LedgerState,
  id: string,
): MutationPreview {
  const current = canonicalizeState(state);
  const index = transactionIndex(current.transactions, id);
  const original = current.transactions[index];
  if (original === undefined) {
    transactionFailure('id', 'Transaction was not found');
  }
  if (isSemesterLocked(current.settings, original.semester)) {
    lockedSemesterTransactionFailure(index + 2);
  }

  const nextTransactions = canonicalizeTransactions(
    current.transactions.filter((_, rowIndex) => rowIndex !== index),
    current.settings,
  );

  return mutationPreview(
    'delete',
    nextTransactions,
    original,
    ALL_TRANSACTION_FIELDS,
  );
}

export function addOption(
  state: LedgerState,
  group: OptionGroup,
  value: string,
): LedgerSettings {
  const optionGroup = requireOptionGroup(group);
  const settings = validateSettingsValue(state.settings);

  const existing = settings[optionGroup].find(
    (option) => option.value === value,
  );
  if (existing?.status === 'active') {
    settingsFailure(optionGroup, 'Option value is already configured');
  }
  if (existing !== undefined) {
    existing.status = 'active';
    if (optionGroup === 'semesters') {
      settings.locked_semesters = settings.locked_semesters.filter(
        (semester) => semester !== value,
      );
    }
    return validateSettingsValue(settings);
  }

  settings[optionGroup].push({value, status: 'active'});
  return validateSettingsValue(settings);
}

export function archiveOption(
  state: LedgerState,
  group: OptionGroup,
  value: string,
): LedgerSettings {
  const optionGroup = requireOptionGroup(group);
  const current = canonicalizeState(state);
  const settings = current.settings;
  const option = settings[optionGroup].find(
    (candidate) => candidate.value === value,
  );

  if (option === undefined) {
    settingsFailure(optionGroup, 'Option is not configured');
  }
  if (option.status === 'archived') {
    settingsFailure(optionGroup, 'Option is already archived');
  }
  if (optionGroup === 'semesters' && settings.active_semester === value) {
    settingsFailure('active_semester', 'Active semester cannot be archived');
  }
  if (optionGroup === 'officers' && settings.default_officer === value) {
    settingsFailure('default_officer', 'Default officer cannot be archived');
  }
  if (optionGroup === 'semesters' && isSemesterLocked(settings, value)) {
    settingsFailure('locked_semesters', 'Locked semester cannot be archived');
  }

  const referenceField = GROUP_REFERENCE_FIELDS[optionGroup];
  const referenceIndex = current.transactions.findIndex(
    (transaction) => transaction[referenceField] === value,
  );
  if (referenceIndex !== -1) {
    transactionFailure(
      referenceField,
      'Referenced option cannot be archived',
      referenceIndex + 2,
    );
  }

  option.status = 'archived';
  return validateSettingsValue(settings);
}

export function moveSemester(
  state: LedgerState,
  value: string,
  direction: SemesterMoveDirection,
): LedgerSettings {
  if (direction !== 'earlier' && direction !== 'later') {
    settingsFailure('direction', 'Semester move direction is not supported');
  }

  const current = canonicalizeState(state);
  const settings = current.settings;
  const index = settings.semesters.findIndex(
    (semester) => semester.value === value,
  );

  if (index === -1) {
    settingsFailure('semesters', 'Semester is not configured');
  }

  const adjacentIndex = direction === 'earlier' ? index - 1 : index + 1;
  const semester = settings.semesters[index];
  const adjacentSemester = settings.semesters[adjacentIndex];

  if (semester === undefined || adjacentSemester === undefined) {
    settingsFailure('semesters', 'Semester cannot move beyond configured order');
  }
  if (
    isSemesterLocked(settings, semester.value) ||
    isSemesterLocked(settings, adjacentSemester.value)
  ) {
    settingsFailure('locked_semesters', 'Locked semester cannot be reordered');
  }

  settings.semesters[index] = adjacentSemester;
  settings.semesters[adjacentIndex] = semester;

  return validateSettingsValue(settings);
}

export function setActiveSemester(
  state: LedgerState,
  value: string,
): LedgerSettings {
  const settings = validateSettingsValue(state.settings);
  if (isSemesterLocked(settings, value)) {
    settingsFailure('active_semester', 'Locked semester cannot become active');
  }
  settings.active_semester = value;
  return validateSettingsValue(settings);
}

export function setSemesterLocked(
  state: LedgerState,
  value: string,
  locked: boolean,
): LedgerSettings {
  const settings = validateSettingsValue(state.settings);

  if (typeof locked !== 'boolean') {
    settingsFailure('locked_semesters', 'Lock state must be a boolean');
  }

  const semester = settings.semesters.find((option) => option.value === value);

  if (semester?.status !== 'active') {
    settingsFailure('locked_semesters', 'Semester must be an active configured option');
  }
  if (locked && settings.active_semester === value) {
    settingsFailure('active_semester', 'Active semester cannot be locked');
  }

  settings.locked_semesters = locked
    ? isSemesterLocked(settings, value)
      ? settings.locked_semesters
      : [...settings.locked_semesters, value]
    : settings.locked_semesters.filter((semesterValue) => semesterValue !== value);

  return validateSettingsValue(settings);
}

export function setDefaultOfficer(
  state: LedgerState,
  value: string,
): LedgerSettings {
  const settings = validateSettingsValue(state.settings);
  settings.default_officer = value;
  return validateSettingsValue(settings);
}
