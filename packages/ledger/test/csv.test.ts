import {describe, expect, it, vi} from 'vitest';

import {
  LedgerValidationError,
  parseTransactionsCsv,
  serializeTransactionsCsv,
  TRANSACTION_HEADERS,
  type LedgerSettings,
  type Transaction,
} from '../src/index.js';
import {validSettings} from './fixture-settings.js';

const transaction: Transaction = {
  id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670001',
  date: '2026-08-17',
  semester: '第一學期',
  subject: '影印講義, A4',
  category: '教材與影印',
  type: 'expense',
  amount: 1537,
  handled_by: '我',
  note: '收據寫著「二年一班」\n已核對',
  created_at: '2026-08-17T18:30:00+08:00',
};

const headers = [
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

type Header = (typeof headers)[number];
type RawTransaction = Record<Header, string>;

const rawTransaction: RawTransaction = {
  ...transaction,
  amount: String(transaction.amount),
};

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function csvText(
  rows: RawTransaction[],
  columns: readonly string[] = headers,
): string {
  const records = rows.map((row) =>
    columns.map((column) => csvCell(row[column as Header] ?? '')).join(','),
  );
  return `${columns.join(',')}\n${records.join('\n')}${records.length > 0 ? '\n' : ''}`;
}

function csvWith(change: Partial<RawTransaction> = {}): string {
  return csvText([{...rawTransaction, ...change}]);
}

function transactionWith(change: Partial<Transaction>): Transaction {
  return {...transaction, ...change};
}

function settingsWithArchivedOptions(): LedgerSettings {
  return {
    ...structuredClone(validSettings),
    semesters: [
      ...validSettings.semesters,
      {value: '已封存學期', status: 'archived'},
    ],
    categories: [
      ...validSettings.categories,
      {value: '已封存類別', status: 'archived'},
    ],
    officers: [
      ...validSettings.officers,
      {value: '已卸任總務', status: 'archived'},
    ],
  };
}

function validationError(run: () => unknown): LedgerValidationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LedgerValidationError);
    return error as LedgerValidationError;
  }

  throw new Error('Expected transaction CSV validation to fail');
}

function expectTransactionIssue(
  error: LedgerValidationError,
  row: number,
  field: string,
): void {
  expect(error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({source: 'transactions', row, field}),
    ]),
  );
}

function expectControlIssue(
  error: LedgerValidationError,
  row: number,
  field: string,
): void {
  expect(error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: 'transactions',
        row,
        field,
        message: 'Control characters are not permitted in this field',
      }),
    ]),
  );
}

describe('canonical transaction CSV', () => {
  it('imports the browser-safe CSV and ledger modules without a global Buffer', async () => {
    const bufferDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'Buffer',
    );

    try {
      vi.resetModules();
      Reflect.deleteProperty(globalThis, 'Buffer');

      const csv = await import('../src/csv.js');
      const ledger = await import('../src/index.js');

      expect(csv.parseTransactionsCsv).toBeTypeOf('function');
      expect(csv.serializeTransactionsCsv).toBeTypeOf('function');
      expect(ledger.parseTransactionsCsv).toBe(csv.parseTransactionsCsv);
      expect(ledger.serializeTransactionsCsv).toBe(
        csv.serializeTransactionsCsv,
      );
    } finally {
      if (bufferDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, 'Buffer');
      } else {
        Object.defineProperty(globalThis, 'Buffer', bufferDescriptor);
      }
      vi.resetModules();
    }
  });

  it('round-trips quoted Traditional Chinese fields with commas and newlines', () => {
    const serialized = serializeTransactionsCsv([transaction], validSettings);

    expect(parseTransactionsCsv(serialized, validSettings)).toEqual([transaction]);
  });

  it('serializes an empty ledger as the exact header and one newline', () => {
    expect(serializeTransactionsCsv([], validSettings)).toBe(
      'id,date,semester,subject,category,type,amount,handled_by,note,created_at\n',
    );
  });

  it('exports the fixed canonical header order', () => {
    expect(TRANSACTION_HEADERS).toEqual(headers);
    expect(serializeTransactionsCsv([transaction]).split('\n', 1)[0]).toBe(
      headers.join(','),
    );
  });

  it('prevents runtime header mutation from changing canonical serialization', () => {
    const mutableHeaders = TRANSACTION_HEADERS as unknown as string[];
    let mutationResult = false;
    let observedHeaders: string[] = [];
    let serializedHeader = '';

    try {
      mutationResult = Reflect.set(mutableHeaders, 0, 'changed_id');
      observedHeaders = [...TRANSACTION_HEADERS];
      serializedHeader =
        serializeTransactionsCsv([transaction]).split('\n', 1)[0] ?? '';
    } finally {
      if (!Object.isFrozen(TRANSACTION_HEADERS)) {
        mutableHeaders.splice(0, mutableHeaders.length, ...headers);
      }
    }

    expect(mutationResult).toBe(false);
    expect(observedHeaders).toEqual(headers);
    expect(serializedHeader).toBe(headers.join(','));
  });

  it('accepts a UTF-8 BOM before the canonical header', () => {
    expect(parseTransactionsCsv(`\ufeff${csvWith()}`, validSettings)).toEqual([
      transaction,
    ]);
  });

  it('parses a header-only file as an empty ledger', () => {
    expect(parseTransactionsCsv(csvText([]), validSettings)).toEqual([]);
  });

  it('preserves legitimate text without trimming or prefixing it', () => {
    const padded = transactionWith({
      subject: '  班費用途  ',
      note: '=SUM(A1:A2)',
    });

    expect(
      parseTransactionsCsv(
        serializeTransactionsCsv([padded], validSettings),
        validSettings,
      ),
    ).toEqual([padded]);
  });

  it('serializes exactly one final newline', () => {
    const serialized = serializeTransactionsCsv(
      [transactionWith({note: '行一\n行二\n'})],
      validSettings,
    );

    expect(serialized.match(/\n+$/)?.[0]).toBe('\n');
  });
});

describe('transaction row validation', () => {
  it('reports amount zero at transaction row 2', () => {
    const error = validationError(() =>
      parseTransactionsCsv(csvWith({amount: '0'}), validSettings),
    );

    expectTransactionIssue(error, 2, 'amount');
  });

  it.each([
    {name: 'negative amount', change: {amount: '-1'}, field: 'amount'},
    {name: 'fractional amount', change: {amount: '1.5'}, field: 'amount'},
    {name: 'nonnumeric amount', change: {amount: 'abc'}, field: 'amount'},
    {name: 'impossible calendar date', change: {date: '2026-02-30'}, field: 'date'},
    {name: 'unknown transaction type', change: {type: 'transfer'}, field: 'type'},
    {name: 'blank subject', change: {subject: '   '}, field: 'subject'},
    {name: 'unknown semester', change: {semester: '第三學期'}, field: 'semester'},
    {name: 'unknown category', change: {category: '其他'}, field: 'category'},
    {name: 'unknown officer', change: {handled_by: '陌生人'}, field: 'handled_by'},
    {name: 'non-UUID ID', change: {id: 'not-a-uuid'}, field: 'id'},
  ])('rejects $name with field and row metadata', ({change, field}) => {
    const error = validationError(() =>
      parseTransactionsCsv(csvWith(change), validSettings),
    );

    expectTransactionIssue(error, 2, field);
  });

  it.each([
    '2026-08-17T10:30:00',
    '2026-08-17T10:30:00Z',
    '2026-08-17T25:30:00+08:00',
  ])('rejects created_at without a valid numeric offset: %s', (createdAt) => {
    const error = validationError(() =>
      parseTransactionsCsv(csvWith({created_at: createdAt}), validSettings),
    );

    expectTransactionIssue(error, 2, 'created_at');
  });

  it.each([
    {
      name: 'parsing',
      run: () =>
        parseTransactionsCsv(
          csvWith({created_at: '2026-02-30T10:30:00+08:00'}),
          validSettings,
        ),
    },
    {
      name: 'serialization',
      run: () =>
        serializeTransactionsCsv(
          [transactionWith({created_at: '2026-02-30T10:30:00+08:00'})],
          validSettings,
        ),
    },
  ])('rejects an impossible created_at calendar date during $name', ({run}) => {
    const error = validationError(run);

    expectTransactionIssue(error, 2, 'created_at');
  });

  it('enforces lowercase UUIDs', () => {
    const error = validationError(() =>
      parseTransactionsCsv(
        csvWith({id: transaction.id.toUpperCase()}),
        validSettings,
      ),
    );

    expectTransactionIssue(error, 2, 'id');
  });

  it('accepts exact dates including a real leap day', () => {
    const leapDay = transactionWith({date: '2024-02-29'});

    expect(
      parseTransactionsCsv(
        serializeTransactionsCsv([leapDay], validSettings),
        validSettings,
      ),
    ).toEqual([leapDay]);
  });

  it('reports a duplicate ID on the later transaction row', () => {
    const second = {
      ...rawTransaction,
      subject: '第二筆',
      created_at: '2026-08-17T18:31:00+08:00',
    };
    const error = validationError(() =>
      parseTransactionsCsv(csvText([rawTransaction, second]), validSettings),
    );

    expectTransactionIssue(error, 3, 'id');
  });

  it('aggregates applicable issues across fields and rows', () => {
    const second = {
      ...rawTransaction,
      id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670002',
      subject: ' ',
      amount: '-8',
    };
    const error = validationError(() =>
      parseTransactionsCsv(
        csvText([{...rawTransaction, date: '2026-02-30'}, second]),
        validSettings,
      ),
    );

    expectTransactionIssue(error, 2, 'date');
    expectTransactionIssue(error, 3, 'subject');
    expectTransactionIssue(error, 3, 'amount');
  });

  it('accepts archived configured values as historical transaction values', () => {
    const settings = settingsWithArchivedOptions();
    const archived = transactionWith({
      semester: '已封存學期',
      category: '已封存類別',
      handled_by: '已卸任總務',
    });

    expect(
      parseTransactionsCsv(serializeTransactionsCsv([archived], settings), settings),
    ).toEqual([archived]);
  });
});

describe('CSV structure validation', () => {
  it.each([
    {
      name: 'reordered headers',
      columns: [headers[1], headers[0], ...headers.slice(2)],
    },
    {
      name: 'renamed header',
      columns: [...headers.slice(0, 3), 'description', ...headers.slice(4)],
    },
    {name: 'extra header', columns: [...headers, 'unexpected']},
    {name: 'missing header', columns: headers.slice(0, -1)},
  ])('rejects $name at the header before inspecting rows', ({columns}) => {
    const error = validationError(() =>
      parseTransactionsCsv(
        csvText([{...rawTransaction, amount: '0'}], columns),
        validSettings,
      ),
    );

    expectTransactionIssue(error, 1, 'header');
    expect(error.issues).toHaveLength(1);
  });

  it.each([
    {
      name: 'extra data column',
      text: `${csvWith().trimEnd()},"unexpected"\n`,
    },
    {
      name: 'missing data column',
      text: `${headers.join(',')}\n${headers
        .slice(0, -1)
        .map((field) => csvCell(rawTransaction[field]))
        .join(',')}\n`,
    },
  ])('rejects an $name as a row 2 CSV issue', ({text}) => {
    const error = validationError(() =>
      parseTransactionsCsv(text, validSettings),
    );

    expectTransactionIssue(error, 2, 'csv');
  });

  it('normalizes malformed CSV as a safe file issue', () => {
    const secret = 'student-name';
    const error = validationError(() =>
      parseTransactionsCsv(
        `${headers.join(',')}\n"${secret}`,
        validSettings,
      ),
    );

    expectTransactionIssue(error, 1, 'csv');
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error.issues)).not.toContain(secret);
  });
});

describe('control character validation', () => {
  const forbiddenCharacters = [
    {name: 'NUL', value: '\u0000'},
    {name: 'another C0 control', value: '\u0001'},
    {name: 'DEL', value: '\u007f'},
    {name: 'a C1 control', value: '\u0085'},
  ];

  it.each(
    forbiddenCharacters.flatMap(({name, value}) =>
      headers.map((field) => ({name, value, field})),
    ),
  )('rejects $name in parsed $field', ({value, field}) => {
    const error = validationError(() =>
      parseTransactionsCsv(
        csvWith({[field]: `${rawTransaction[field]}${value}`}),
        validSettings,
      ),
    );

    expectControlIssue(error, 2, field);
  });

  it.each(headers.filter((field) => field !== 'note'))(
    'rejects LF in parsed %s',
    (field) => {
      const error = validationError(() =>
        parseTransactionsCsv(
          csvWith({[field]: `${rawTransaction[field]}\ncontinued`}),
          validSettings,
        ),
      );

      expectControlIssue(error, 2, field);
    },
  );

  it('permits LF inside note', () => {
    expect(parseTransactionsCsv(csvWith(), validSettings)).toEqual([transaction]);
  });

  it.each(
    forbiddenCharacters.flatMap(({name, value}) =>
      headers
        .filter((field) => field !== 'amount')
        .map((field) => ({name, value, field})),
    ),
  )('rejects $name in serialized $field', ({value, field}) => {
    const error = validationError(() =>
      serializeTransactionsCsv(
        [
          transactionWith({
            [field]: `${String(transaction[field as keyof Transaction])}${value}`,
          }),
        ],
        validSettings,
      ),
    );

    expectControlIssue(error, 2, field);
  });

  it.each(headers.filter((field) => field !== 'amount' && field !== 'note'))(
    'rejects LF in serialized %s',
    (field) => {
      const error = validationError(() =>
        serializeTransactionsCsv(
          [
            transactionWith({
              [field]: `${String(transaction[field as keyof Transaction])}\ncontinued`,
            }),
          ],
          validSettings,
        ),
      );

      expectControlIssue(error, 2, field);
    },
  );
});

describe('serializer validation', () => {
  it('rejects a sparse transaction row instead of omitting it', () => {
    const error = validationError(() =>
      serializeTransactionsCsv(new Array<Transaction>(1), validSettings),
    );

    expectTransactionIssue(error, 2, '$');
  });

  it('validates intrinsic fields and reports transaction row metadata', () => {
    const error = validationError(() =>
      serializeTransactionsCsv([transactionWith({amount: 0})], validSettings),
    );

    expectTransactionIssue(error, 2, 'amount');
  });

  it('rejects duplicate IDs while serializing', () => {
    const error = validationError(() =>
      serializeTransactionsCsv(
        [transaction, transactionWith({subject: '第二筆'})],
        validSettings,
      ),
    );

    expectTransactionIssue(error, 3, 'id');
  });

  it('checks configured membership when settings are supplied', () => {
    const error = validationError(() =>
      serializeTransactionsCsv(
        [transactionWith({category: '不存在的類別'})],
        validSettings,
      ),
    );

    expectTransactionIssue(error, 2, 'category');
  });

  it('does not require configured membership when settings are omitted', () => {
    const unconfigured = transactionWith({
      semester: '匯入學期',
      category: '匯入類別',
      handled_by: '匯入總務',
    });

    expect(() => serializeTransactionsCsv([unconfigured])).not.toThrow();
  });

  it('keeps archived configured values valid while serializing', () => {
    const settings = settingsWithArchivedOptions();
    const archived = transactionWith({
      semester: '已封存學期',
      category: '已封存類別',
      handled_by: '已卸任總務',
    });

    expect(() => serializeTransactionsCsv([archived], settings)).not.toThrow();
  });
});
