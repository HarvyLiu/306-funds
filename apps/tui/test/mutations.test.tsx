import {
  LedgerValidationError,
  SourceConflictError,
  type LedgerSettings,
  type LedgerState,
  type MutationPreview,
  type Transaction,
} from '@class-fund/ledger';
import type {LedgerRepository} from '@class-fund/ledger/node';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {App} from '../src/app.js';
import {ConfirmScreen} from '../src/screens/confirm-screen.js';
import {DeleteScreen} from '../src/screens/delete-screen.js';

const settings: LedgerSettings = {
  schema_version: 2,
  currency: 'TWD',
  active_semester: '第一學期',
  default_officer: '我',
  locked_semesters: [],
  semesters: [{value: '第一學期', status: 'active'}],
  categories: [
    {value: '期初餘額', status: 'active'},
    {value: '教材與影印', status: 'active'},
  ],
  officers: [
    {value: '我', status: 'active'},
    {value: '另一位總務', status: 'active'},
  ],
};

const transaction: Transaction = {
  id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670001',
  date: '2026-08-17',
  semester: '第一學期',
  subject: '影印講義',
  category: '教材與影印',
  type: 'expense',
  amount: 1537,
  handled_by: '我',
  note: '班會資料',
  created_at: '2026-08-17T10:00:00+08:00',
};

function preview(overrides: Partial<MutationPreview> = {}): MutationPreview {
  return {
    kind: 'add',
    nextTransactions: [transaction],
    resultingBalance: 3463,
    createsNegativeBalance: false,
    changedFields: [
      'date',
      'semester',
      'subject',
      'category',
      'type',
      'amount',
      'handled_by',
      'note',
    ],
    target: transaction,
    ...overrides,
  };
}

afterEach(() => cleanup());

async function nextRender(): Promise<void> {
  await new Promise<void>((done) => setImmediate(done));
}

async function clearInput(
  stdin: {write(data: string): void},
  value: string,
): Promise<void> {
  for (const _character of value) {
    stdin.write('\u007f');
    await nextRender();
  }
}

function fakeRepository(initialTransactions: Transaction[] = []) {
  let state: LedgerState = {
    settings: structuredClone(settings),
    transactions: structuredClone(initialTransactions),
  };
  const getState = vi.fn(() => structuredClone(state));
  const saveTransactions = vi.fn(async (next: Transaction[]) => {
    state = {...state, transactions: structuredClone(next)};
  });
  return {
    repository: {
      getState,
      saveTransactions,
      saveSettings: vi.fn(),
    } as unknown as LedgerRepository,
    getState,
    saveTransactions,
  };
}

async function advanceAddForm(stdin: {write(data: string): void}) {
  stdin.write('\r');
  await nextRender();
  stdin.write('影印講義');
  await nextRender();
  stdin.write('\r');
  await nextRender();
  stdin.write('2');
  await nextRender();
  stdin.write('2');
  await nextRender();
  stdin.write('1537');
  await nextRender();
  stdin.write('\r');
  await nextRender();
  stdin.write('1');
  await nextRender();
  stdin.write('1');
  await nextRender();
  stdin.write('班會資料');
  await nextRender();
  stdin.write('\r');
  await nextRender();
}

describe('ConfirmScreen', () => {
  it('shows every public field, disclosure notice, and resulting balance', () => {
    const {lastFrame} = render(
      <ConfirmScreen
        preview={preview()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('2026-08-17');
    expect(lastFrame()).toContain('影印講義');
    expect(lastFrame()).toContain('教材與影印');
    expect(lastFrame()).toContain('支出');
    expect(lastFrame()).toContain('NT$1,537');
    expect(lastFrame()).toContain('我');
    expect(lastFrame()).toContain('第一學期');
    expect(lastFrame()).toContain('班會資料');
    expect(lastFrame()).toContain('項目與備註內容將公開');
    expect(lastFrame()).toContain('NT$3,463');
    expect(lastFrame()).not.toContain('警告：儲存後餘額為負數');
    expect(lastFrame()).not.toContain('變更欄位');
  });

  it('shows the changed fields clearly for an edit preview', () => {
    const {lastFrame} = render(
      <ConfirmScreen
        preview={preview({
          kind: 'edit',
          changedFields: ['date', 'subject', 'amount'],
        })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('變更欄位：日期、項目、金額');
    expect(lastFrame()).toContain('項目與備註內容將公開');
  });

  it('adds a negative-balance warning and confirms only once with y', async () => {
    const onConfirm = vi.fn();
    const {lastFrame, stdin} = render(
      <ConfirmScreen
        preview={preview({
          resultingBalance: -37,
          createsNegativeBalance: true,
        })}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('警告：儲存後餘額為負數');
    expect(lastFrame()).toContain('項目與備註內容將公開');
    stdin.write('y');
    stdin.write('y');
    await nextRender();
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('DeleteScreen', () => {
  it('shows the exact transaction and only y confirms deletion once', async () => {
    const onConfirm = vi.fn();
    const {lastFrame, stdin} = render(
      <DeleteScreen
        transaction={transaction}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    for (const value of [
      transaction.date,
      transaction.subject,
      transaction.category,
      '支出',
      'NT$1,537',
      transaction.handled_by,
      transaction.semester,
      transaction.note,
    ]) {
      expect(lastFrame()).toContain(value);
    }

    stdin.write('\r');
    await nextRender();
    expect(onConfirm).not.toHaveBeenCalled();
    stdin.write('y');
    stdin.write('y');
    await nextRender();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it.each(['n', '\u001b[27u'])('cancels with %j without deleting', async (input) => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const {stdin} = render(
      <DeleteScreen
        transaction={transaction}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    stdin.write(input);
    await nextRender();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('App transaction mutations', () => {
  it('opens add with the injected date, previews, saves, refreshes, and selects it', async () => {
    const fake = fakeRepository();
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={fake.repository}
        setupComplete
        onExit={vi.fn()}
        today={() => '2026-08-17'}
      />,
    );

    stdin.write('a');
    await nextRender();
    expect(lastFrame()).toContain('新增交易');
    expect(lastFrame()).toContain('2026-08-17');
    await advanceAddForm(stdin);
    expect(lastFrame()).toContain('確認交易');
    expect(lastFrame()).toContain('項目與備註內容將公開');

    stdin.write('y');
    await vi.waitFor(() => expect(fake.saveTransactions).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(lastFrame()).toContain('› 2026-08-17'));
    expect(lastFrame()).toContain('影印講義');
    expect(fake.getState).toHaveBeenCalledTimes(2);
  });

  it('opens edit for the selected transaction with its existing values', async () => {
    const fake = fakeRepository([transaction]);
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={fake.repository}
        setupComplete
        onExit={vi.fn()}
        today={() => '2026-09-30'}
      />,
    );

    stdin.write('e');
    await nextRender();
    expect(lastFrame()).toContain('編輯交易');
    expect(lastFrame()).toContain(transaction.date);
  });

  it('previews, saves, refreshes, and reselects an edited row after it moves', async () => {
    const newerTransaction: Transaction = {
      ...transaction,
      id: '018f7f2c-98c0-7d5a-a4df-1bcd4a670002',
      date: '2026-08-01',
      subject: '另一筆交易',
      amount: 100,
      created_at: '2026-08-01T10:00:00+08:00',
    };
    const fake = fakeRepository([transaction, newerTransaction]);
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={fake.repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('› 2026-08-17');
    stdin.write('e');
    await nextRender();
    await clearInput(stdin, transaction.date);
    stdin.write('2026-07-01');
    await nextRender();
    stdin.write('\r');
    await nextRender();
    stdin.write('\r');
    await nextRender();
    stdin.write('\r');
    await nextRender();
    stdin.write('\r');
    await nextRender();
    stdin.write('\r');
    await nextRender();
    stdin.write('\r');
    await nextRender();
    stdin.write('\r');
    await nextRender();
    stdin.write('\r');
    await nextRender();

    expect(lastFrame()).toContain('確認交易');
    expect(lastFrame()).toContain('變更欄位：日期');
    stdin.write('y');
    await vi.waitFor(() => expect(fake.saveTransactions).toHaveBeenCalledOnce());
    expect(fake.saveTransactions).toHaveBeenCalledWith([
      {...transaction, date: '2026-07-01'},
      newerTransaction,
    ]);
    await vi.waitFor(() => expect(lastFrame()).toContain('› 2026-07-01'));
    expect(fake.getState).toHaveBeenCalledTimes(2);
  });

  it('requires a selected row before edit or delete', async () => {
    const fake = fakeRepository();
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={fake.repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('e');
    stdin.write('d');
    await nextRender();
    expect(lastFrame()).toContain('尚無交易紀錄');
    expect(lastFrame()).not.toContain('編輯交易');
    expect(lastFrame()).not.toContain('刪除交易');
  });

  it('previews and deletes the selected transaction after explicit y', async () => {
    const fake = fakeRepository([transaction]);
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={fake.repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('d');
    await nextRender();
    expect(lastFrame()).toContain('刪除交易');
    expect(lastFrame()).toContain(transaction.subject);
    stdin.write('\r');
    await nextRender();
    expect(fake.saveTransactions).not.toHaveBeenCalled();
    stdin.write('y');
    await vi.waitFor(() => expect(fake.saveTransactions).toHaveBeenCalledOnce());
    expect(fake.saveTransactions).toHaveBeenCalledWith([]);
    await vi.waitFor(() => expect(lastFrame()).toContain('尚無交易紀錄'));
  });

  it('shows the exact source-conflict message without retrying or leaking the path', async () => {
    const fake = fakeRepository();
    const secretPath = '/private/student-data.csv';
    fake.saveTransactions.mockRejectedValueOnce(
      new SourceConflictError(secretPath),
    );
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={fake.repository}
        setupComplete
        onExit={vi.fn()}
        today={() => '2026-08-17'}
      />,
    );

    stdin.write('a');
    await nextRender();
    await advanceAddForm(stdin);
    stdin.write('y');
    await vi.waitFor(() =>
      expect(lastFrame()).toContain(
        '檔案已被外部修改。請重新載入後再試。',
      ),
    );
    expect(fake.saveTransactions).toHaveBeenCalledOnce();
    expect(lastFrame()).not.toContain(secretPath);
    expect(lastFrame()).not.toContain('Source changed');
  });

  it('renders typed issues by source, row, field, and message without raw values', async () => {
    const fake = fakeRepository([transaction]);
    const privateUuid = 'PRIVATE-STUDENT-UUID';
    const privateAmount = 'private-student-amount';
    fake.saveTransactions.mockRejectedValueOnce(
      new LedgerValidationError([
        {
          source: 'transactions',
          row: 2,
          field: 'id',
          value: privateUuid,
          message: 'ID must be a lowercase UUID',
        },
        {
          source: 'transactions',
          row: 3,
          field: 'amount',
          value: privateAmount,
          message: 'Amount must be a positive whole number',
        },
        {
          source: 'settings',
          field: 'json',
          value: '{private settings',
          message: 'Malformed JSON',
        },
      ]),
    );
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={fake.repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('d');
    await nextRender();
    stdin.write('y');
    await vi.waitFor(() =>
      expect(lastFrame()).toContain('交易 / 第 2 列 / id：ID 必須是小寫 UUID'),
    );
    expect(lastFrame()).toContain('交易 / 第 3 列 / amount：金額必須是正整數');
    expect(lastFrame()).toContain('設定 / json：JSON 格式錯誤');
    expect(lastFrame()).not.toContain(privateUuid);
    expect(lastFrame()).not.toContain(privateAmount);
    expect(lastFrame()).not.toContain('{private settings');
    expect(lastFrame()).not.toContain('ID must be a lowercase UUID');
    expect(lastFrame()).not.toContain('Amount must be a positive whole number');
    expect(lastFrame()).not.toContain('Malformed JSON');
    expect(lastFrame()).not.toContain('Ledger data validation failed');
  });
});
