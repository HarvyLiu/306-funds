import type {
  LedgerSettings,
  TransactionInput,
} from '@class-fund/ledger';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {TransactionForm} from '../src/screens/transaction-form.js';

const settings: LedgerSettings = {
  schema_version: 2,
  currency: 'TWD',
  active_semester: '第一學期',
  default_officer: '我',
  locked_semesters: [],
  semesters: [
    {value: '第二學期', status: 'active'},
    {value: '第一學期', status: 'active'},
    {value: '舊學期', status: 'archived'},
  ],
  categories: [
    {value: '期初餘額', status: 'active'},
    {value: '教材與影印', status: 'active'},
    {value: '舊分類', status: 'archived'},
  ],
  officers: [
    {value: '另一位總務', status: 'active'},
    {value: '我', status: 'active'},
    {value: '舊總務', status: 'archived'},
  ],
};

const editValue: TransactionInput = {
  date: '2026-03-05',
  semester: '舊學期',
  subject: '原始項目',
  category: '舊分類',
  type: 'income',
  amount: 2080,
  handled_by: '舊總務',
  note: '原始備註',
};

afterEach(() => cleanup());

async function nextRender(): Promise<void> {
  await new Promise<void>((done) => setImmediate(done));
}

async function submitText(
  stdin: {write(data: string): void},
  value: string,
): Promise<void> {
  stdin.write(value);
  await nextRender();
  stdin.write('\r');
  await nextRender();
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

describe('TransactionForm', () => {
  it('collects a valid add transaction with configured defaults', async () => {
    const onReview = vi.fn();
    const {lastFrame, stdin} = render(
      <TransactionForm
        mode="add"
        settings={settings}
        today="2026-08-17"
        onReview={onReview}
        onCancel={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('2026-08-17');
    stdin.write('\r');
    await nextRender();
    await submitText(stdin, '影印講義');

    expect(lastFrame()).toContain('教材與影印');
    stdin.write('2');
    await nextRender();

    expect(lastFrame()).toContain('收入');
    expect(lastFrame()).toContain('支出');
    stdin.write('2');
    await nextRender();

    await submitText(stdin, '1537');
    expect(lastFrame()).toContain('我');
    stdin.write('2');
    await nextRender();

    expect(lastFrame()).toContain('第一學期');
    stdin.write('2');
    await nextRender();
    await submitText(stdin, '班會資料');

    expect(onReview).toHaveBeenCalledOnce();
    expect(onReview).toHaveBeenCalledWith({
      date: '2026-08-17',
      semester: '第一學期',
      subject: '影印講義',
      category: '教材與影印',
      type: 'expense',
      amount: 1537,
      handled_by: '我',
      note: '班會資料',
    });
  });

  it('rejects a calendar date that only matches the date shape', async () => {
    const onReview = vi.fn();
    const {lastFrame, stdin} = render(
      <TransactionForm
        mode="add"
        settings={settings}
        today="2026-08-17"
        onReview={onReview}
        onCancel={vi.fn()}
      />,
    );

    await clearInput(stdin, '2026-08-17');
    await submitText(stdin, '2026-02-30');

    expect(lastFrame()).toContain('請輸入有效日期');
    expect(lastFrame()).toContain('2026-02-30');
    expect(onReview).not.toHaveBeenCalled();
  });

  it.each(['', '0', '-1', '1.5', 'abc'])(
    'rejects invalid whole-dollar amount %j',
    async (amount) => {
      const onReview = vi.fn();
      const {lastFrame, stdin} = render(
        <TransactionForm
          mode="add"
          settings={settings}
          today="2026-08-17"
          onReview={onReview}
          onCancel={vi.fn()}
        />,
      );

      stdin.write('\r');
      await nextRender();
      await submitText(stdin, '講義');
      stdin.write('1');
      await nextRender();
      stdin.write('2');
      await nextRender();
      await submitText(stdin, amount);

      expect(lastFrame()).toContain('金額必須是正整數');
      expect(onReview).not.toHaveBeenCalled();
    },
  );

  it('omits archived selectors for add mode', async () => {
    const {lastFrame, stdin} = render(
      <TransactionForm
        mode="add"
        settings={settings}
        today="2026-08-17"
        onReview={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    stdin.write('\r');
    await nextRender();
    await submitText(stdin, '講義');
    expect(lastFrame()).not.toContain('舊分類');
    stdin.write('1');
    await nextRender();
    stdin.write('1');
    await nextRender();
    await submitText(stdin, '100');
    expect(lastFrame()).not.toContain('舊總務');
    stdin.write('1');
    await nextRender();
    expect(lastFrame()).not.toContain('舊學期');
  });

  it.each([
    {name: 'empty', categories: []},
    {
      name: 'all archived',
      categories: [{value: '舊分類', status: 'archived' as const}],
    },
  ])(
    'guides and safely cancels add mode with $name categories',
    async ({categories}) => {
      const onReview = vi.fn();
      const onCancel = vi.fn();
      const {lastFrame, stdin} = render(
        <TransactionForm
          mode="add"
          settings={{...settings, categories}}
          today="2026-08-17"
          onReview={onReview}
          onCancel={onCancel}
        />,
      );

      stdin.write('\r');
      await nextRender();
      await submitText(stdin, '講義');
      expect(lastFrame()).toContain('目前沒有可用的分類');
      expect(lastFrame()).toContain('請先到設定新增或啟用分類');
      expect(lastFrame()).not.toContain('Enter 繼續');

      stdin.write('\r');
      await nextRender();
      expect(lastFrame()).toContain('目前沒有可用的分類');
      expect(onReview).not.toHaveBeenCalled();

      stdin.write('\u001b[27u');
      await nextRender();
      expect(onCancel).toHaveBeenCalledOnce();
      expect(onReview).not.toHaveBeenCalled();
    },
  );

  it('starts edit mode with every value and includes its archived selectors', async () => {
    const onReview = vi.fn();
    const {lastFrame, stdin} = render(
      <TransactionForm
        mode="edit"
        settings={settings}
        initialValue={editValue}
        today="2026-08-17"
        onReview={onReview}
        onCancel={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain(editValue.date);
    stdin.write('\r');
    await nextRender();
    expect(lastFrame()).toContain(editValue.subject);
    stdin.write('\r');
    await nextRender();
    expect(lastFrame()).toContain('舊分類');
    stdin.write('\r');
    await nextRender();
    expect(lastFrame()).toContain('收入');
    stdin.write('\r');
    await nextRender();
    expect(lastFrame()).toContain('2080');
    stdin.write('\r');
    await nextRender();
    expect(lastFrame()).toContain('舊總務');
    stdin.write('\r');
    await nextRender();
    expect(lastFrame()).toContain('舊學期');
    stdin.write('\r');
    await nextRender();
    expect(lastFrame()).toContain(editValue.note);
    stdin.write('\r');
    await nextRender();

    expect(onReview).toHaveBeenCalledWith(editValue);
  });

  it('accepts an empty single-line note', async () => {
    const onReview = vi.fn();
    const {stdin} = render(
      <TransactionForm
        mode="add"
        settings={settings}
        today="2026-08-17"
        onReview={onReview}
        onCancel={vi.fn()}
      />,
    );

    stdin.write('\r');
    await nextRender();
    await submitText(stdin, '講義');
    stdin.write('1');
    await nextRender();
    stdin.write('1');
    await nextRender();
    await submitText(stdin, '100');
    stdin.write('2');
    await nextRender();
    stdin.write('2');
    await nextRender();
    stdin.write('\r');
    await nextRender();

    expect(onReview).toHaveBeenCalledWith(
      expect.objectContaining({note: ''}),
    );
  });

  it('cancels on Escape without submitting or owning a repository', async () => {
    const onReview = vi.fn();
    const onCancel = vi.fn();
    const {stdin} = render(
      <TransactionForm
        mode="add"
        settings={settings}
        today="2026-08-17"
        onReview={onReview}
        onCancel={onCancel}
      />,
    );

    stdin.write('\u001b[27u');
    await nextRender();

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onReview).not.toHaveBeenCalled();
    expect('repository' in ({} as Record<string, unknown>)).toBe(false);
  });
});
