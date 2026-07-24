import {parse} from 'csv-parse/browser/esm/sync';
import {stringify} from 'csv-stringify/browser/esm/sync';

import {LedgerValidationError} from './errors.js';
import type {
  LedgerIssue,
  LedgerSettings,
  Transaction,
  TransactionType,
} from './types.js';

const CANONICAL_TRANSACTION_HEADERS = [
  'id',
  'date',
  'semester',
  'subject',
  'category',
  'type',
  'amount',
  'handled_by',
  'note',
  'created_at',
] as const;

export const TRANSACTION_HEADERS = Object.freeze([
  ...CANONICAL_TRANSACTION_HEADERS,
] as const);

type TransactionHeader = (typeof CANONICAL_TRANSACTION_HEADERS)[number];
type ParsedTransaction = Record<TransactionHeader, string>;

const LOWERCASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;
const NOTE_CONTROL_CHARACTER = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

function transactionIssue(
  row: number,
  field: string,
  value: unknown,
  message: string,
): LedgerIssue {
  return {
    source: 'transactions',
    row,
    field,
    ...(value === undefined ? {} : {value}),
    message,
  };
}

function structuralError(row: number, field: 'header' | 'csv', message: string): never {
  throw new LedgerValidationError([
    transactionIssue(row, field, undefined, message),
  ]);
}

function hasExactHeader(header: string[]): boolean {
  return (
    header.length === CANONICAL_TRANSACTION_HEADERS.length &&
    header.every((field, index) => field === CANONICAL_TRANSACTION_HEADERS[index])
  );
}

function readAndValidateHeader(text: string): void {
  let records: string[][];

  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      to: 1,
    });
  } catch {
    structuralError(1, 'csv', 'Malformed CSV');
  }

  if (records.length !== 1 || !hasExactHeader(records[0] ?? [])) {
    structuralError(1, 'header', 'CSV header must match the canonical order');
  }
}

function structuralRow(error: unknown): number {
  if (error === null || typeof error !== 'object') return 1;

  const candidate = error as {code?: unknown; records?: unknown};
  if (
    candidate.code !== 'CSV_RECORD_INCONSISTENT_COLUMNS' &&
    candidate.code !== 'CSV_RECORD_INCONSISTENT_FIELDS_LENGTH'
  ) {
    return 1;
  }

  return typeof candidate.records === 'number' &&
    Number.isSafeInteger(candidate.records) &&
    candidate.records >= 0
    ? candidate.records + 2
    : 1;
}

function parseRecords(text: string): ParsedTransaction[] {
  try {
    return parse<ParsedTransaction>(text, {
      bom: true,
      columns: true,
      relax_column_count: false,
      skip_empty_lines: true,
    });
  } catch (error) {
    structuralError(structuralRow(error), 'csv', 'Malformed CSV');
  }
}

function isExactDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const reconstructed = new Date(0);
  reconstructed.setUTCHours(0, 0, 0, 0);
  reconstructed.setUTCFullYear(year, month - 1, day);

  return (
    reconstructed.getUTCFullYear() === year &&
    reconstructed.getUTCMonth() === month - 1 &&
    reconstructed.getUTCDate() === day
  );
}

function isTransactionType(value: unknown): value is TransactionType {
  return value === 'income' || value === 'expense';
}

function configuredValues(settings: LedgerSettings | undefined): {
  semesters?: Set<string>;
  categories?: Set<string>;
  officers?: Set<string>;
} {
  if (settings === undefined) return {};

  return {
    semesters: new Set(settings.semesters.map((option) => option.value)),
    categories: new Set(settings.categories.map((option) => option.value)),
    officers: new Set(settings.officers.map((option) => option.value)),
  };
}

function inspectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validateTransactions(
  records: readonly unknown[],
  settings?: LedgerSettings,
): Transaction[] {
  const issues: LedgerIssue[] = [];
  const validated: Transaction[] = [];
  const seenIds = new Set<string>();
  const configured = configuredValues(settings);

  for (let index = 0; index < records.length; index += 1) {
    const candidate = records[index];
    const row = index + 2;
    const issueCount = issues.length;
    const record = inspectRecord(candidate);

    if (record === null) {
      issues.push(
        transactionIssue(row, '$', candidate, 'Transaction must be an object'),
      );
      continue;
    }

    for (const field of CANONICAL_TRANSACTION_HEADERS) {
      const value = record[field];
      if (typeof value !== 'string') continue;

      const hasControl =
        field === 'note'
          ? NOTE_CONTROL_CHARACTER.test(value)
          : CONTROL_CHARACTER.test(value);
      if (hasControl) {
        issues.push(
          transactionIssue(
            row,
            field,
            value,
            'Control characters are not permitted in this field',
          ),
        );
      }
    }

    const id = record.id;
    if (typeof id !== 'string' || !LOWERCASE_UUID.test(id)) {
      issues.push(
        transactionIssue(row, 'id', id, 'ID must be a lowercase UUID'),
      );
    }
    if (typeof id === 'string') {
      if (seenIds.has(id)) {
        issues.push(
          transactionIssue(row, 'id', id, 'Transaction IDs must be unique'),
        );
      }
      seenIds.add(id);
    }

    const date = record.date;
    if (typeof date !== 'string' || !isExactDate(date)) {
      issues.push(
        transactionIssue(row, 'date', date, 'Date must be a real YYYY-MM-DD date'),
      );
    }

    const semester = record.semester;
    if (typeof semester !== 'string') {
      issues.push(
        transactionIssue(row, 'semester', semester, 'Semester must be text'),
      );
    } else if (
      configured.semesters !== undefined &&
      !configured.semesters.has(semester)
    ) {
      issues.push(
        transactionIssue(row, 'semester', semester, 'Semester is not configured'),
      );
    }

    const subject = record.subject;
    if (typeof subject !== 'string' || subject.trim().length === 0) {
      issues.push(
        transactionIssue(row, 'subject', subject, 'Subject must not be blank'),
      );
    }

    const category = record.category;
    if (typeof category !== 'string') {
      issues.push(
        transactionIssue(row, 'category', category, 'Category must be text'),
      );
    } else if (
      configured.categories !== undefined &&
      !configured.categories.has(category)
    ) {
      issues.push(
        transactionIssue(row, 'category', category, 'Category is not configured'),
      );
    }

    const type = record.type;
    if (!isTransactionType(type)) {
      issues.push(
        transactionIssue(row, 'type', type, 'Type must be income or expense'),
      );
    }

    const rawAmount = record.amount;
    const amount =
      typeof rawAmount === 'string' && /^[0-9]+$/.test(rawAmount)
        ? Number(rawAmount)
        : rawAmount;
    if (
      typeof amount !== 'number' ||
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {
      issues.push(
        transactionIssue(
          row,
          'amount',
          rawAmount,
          'Amount must be a positive whole number',
        ),
      );
    }

    const handledBy = record.handled_by;
    if (typeof handledBy !== 'string') {
      issues.push(
        transactionIssue(row, 'handled_by', handledBy, 'Officer must be text'),
      );
    } else if (
      configured.officers !== undefined &&
      !configured.officers.has(handledBy)
    ) {
      issues.push(
        transactionIssue(row, 'handled_by', handledBy, 'Officer is not configured'),
      );
    }

    const note = record.note;
    if (typeof note !== 'string') {
      issues.push(transactionIssue(row, 'note', note, 'Note must be text'));
    }

    const createdAt = record.created_at;
    if (
      typeof createdAt !== 'string' ||
      !ISO_TIMESTAMP_WITH_OFFSET.test(createdAt) ||
      !isExactDate(createdAt.slice(0, 10)) ||
      Number.isNaN(Date.parse(createdAt))
    ) {
      issues.push(
        transactionIssue(
          row,
          'created_at',
          createdAt,
          'Created timestamp must be ISO-8601 with a numeric offset',
        ),
      );
    }

    if (issues.length === issueCount) {
      validated.push({
        id: id as string,
        date: date as string,
        semester: semester as string,
        subject: subject as string,
        category: category as string,
        type: type as TransactionType,
        amount: amount as number,
        handled_by: handledBy as string,
        note: note as string,
        created_at: createdAt as string,
      });
    }
  }

  if (issues.length > 0) throw new LedgerValidationError(issues);
  return validated;
}

export function parseTransactionsCsv(
  text: string,
  settings: LedgerSettings,
): Transaction[] {
  readAndValidateHeader(text);
  return validateTransactions(parseRecords(text), settings);
}

export function serializeTransactionsCsv(
  transactions: Transaction[],
  settings?: LedgerSettings,
): string {
  const validated = validateTransactions(transactions, settings);

  try {
    return stringify(validated, {
      columns: CANONICAL_TRANSACTION_HEADERS,
      eof: true,
      escape_formulas: false,
      header: true,
      record_delimiter: '\n',
    });
  } catch {
    structuralError(1, 'csv', 'Could not serialize CSV');
  }
}
