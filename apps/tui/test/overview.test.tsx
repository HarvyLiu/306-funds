import type {LedgerSettings, LedgerState, Transaction} from '@class-fund/ledger';
import {createLedgerView, emptyFilter} from '@class-fund/ledger';
import type {LedgerInspection, LedgerRepository} from '@class-fund/ledger/node';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {App} from '../src/app.js';
import {TransactionTable} from '../src/components/transaction-table.js';

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
    {value: '清潔用品', status: 'active'},
  ],
  officers: [
    {value: '我', status: 'active'},
    {value: '另一位總務', status: 'active'},
  ],
};

const transactions: Transaction[] = [
  {
    id: 'expense-latest',
    date: '2026-09-02',
    semester: '第一學期',
    subject: '影印',
    category: '教材與影印',
    type: 'expense',
    amount: 300,
    handled_by: '我',
    note: '數學講義',
    created_at: '2026-09-02T09:00:00+08:00',
  },
  {
    id: 'opening',
    date: '2026-08-01',
    semester: '第一學期',
    subject: '期初',
    category: '期初餘額',
    type: 'income',
    amount: 5000,
    handled_by: '我',
    note: '',
    created_at: '2026-08-01T08:00:00+08:00',
  },
  {
    id: 'expense-earlier',
    date: '2026-09-02',
    semester: '第一學期',
    subject: '清潔用品',
    category: '清潔用品',
    type: 'expense',
    amount: 700,
    handled_by: '另一位總務',
    note: '掃具',
    created_at: '2026-09-02T08:00:00+08:00',
  },
];

afterEach(() => cleanup());

function repositoryWith(state: LedgerState): LedgerRepository {
  return {
    getState: vi.fn(() => structuredClone(state)),
    saveSettings: vi.fn(),
  } as unknown as LedgerRepository;
}

function selectedLine(frame: string | undefined): string | undefined {
  return frame?.split('\n').find((line) => line.startsWith('› '));
}

function summaryLine(frame: string | undefined): string | undefined {
  return frame?.split('\n').find((line) => line.includes('目前總餘額'));
}

function frameWidth(frame: string | undefined): number {
  return Math.max(...(frame ?? '').split('\n').map((line) => line.length));
}

function terminalWidth(line: string): number {
  return [...line].reduce((width, character) => {
    if (character === '›' || character === '…') return width + 1;
    return width + (character.codePointAt(0)! > 0xff ? 2 : 1);
  }, 0);
}

async function nextRender(): Promise<void> {
  await new Promise<void>((done) => setImmediate(done));
}

describe('ledger overview', () => {
  it('renders the title, overall balance, rows, running balance, and quits', () => {
    const onExit = vi.fn();
    const fakeRepository = repositoryWith({settings, transactions});
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={fakeRepository}
        setupComplete
        onExit={onExit}
      />,
    );

    expect(lastFrame()).toContain('班費帳本');
    expect(lastFrame()).toContain('目前總餘額  NT$4,000');
    expect(lastFrame()).toContain('影印');
    expect(lastFrame()).toContain('NT$300');
    expect(lastFrame()).toContain('NT$4,000');

    stdin.write('q');
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('moves one fixed marker with arrows and j/k, clamping at both ends', async () => {
    const fakeRepository = repositoryWith({settings, transactions});
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={fakeRepository}
        setupComplete
        onExit={vi.fn()}
      />,
    );
    const initialSummary = summaryLine(lastFrame());
    const initialWidth = frameWidth(lastFrame());
    expect(selectedLine(lastFrame())).toContain('影印');

    stdin.write('\u001b[B');
    await nextRender();
    expect(selectedLine(lastFrame())).toContain('清潔用品');

    stdin.write('j');
    await nextRender();
    expect(selectedLine(lastFrame())).toContain('期初');

    stdin.write('\u001b[B');
    stdin.write('j');
    await nextRender();
    expect(selectedLine(lastFrame())).toContain('期初');

    stdin.write('\u001b[A');
    await nextRender();
    expect(selectedLine(lastFrame())).toContain('清潔用品');

    stdin.write('k');
    await nextRender();
    expect(selectedLine(lastFrame())).toContain('影印');

    stdin.write('k');
    await nextRender();
    expect(selectedLine(lastFrame())).toContain('影印');
    expect(summaryLine(lastFrame())).toBe(initialSummary);
    expect(frameWidth(lastFrame())).toBe(initialWidth);
  });

  it('handles an empty ledger and navigation keys safely', async () => {
    const fakeRepository = repositoryWith({settings, transactions: []});
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={fakeRepository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('目前總餘額  NT$0');
    expect(lastFrame()).toContain('尚無交易紀錄');
    stdin.write('\u001b[B');
    stdin.write('\u001b[A');
    stdin.write('j');
    stdin.write('k');
    await nextRender();
    expect(lastFrame()).toContain('尚無交易紀錄');
    expect(selectedLine(lastFrame())).toBeUndefined();
  });

  it('shows a semester opening balance independent of secondary filters', async () => {
    const fakeRepository = repositoryWith({settings, transactions});
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={fakeRepository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    expect(lastFrame()).not.toContain('期初結餘');
    stdin.write('f');
    await nextRender();
    stdin.write('2');
    await nextRender();
    stdin.write('1');
    await nextRender();
    stdin.write('1');
    await nextRender();
    stdin.write('1');
    await nextRender();

    expect(lastFrame()).toContain('期初結餘');
    expect(lastFrame()).toContain('NT$0');
    stdin.write('/');
    await nextRender();
    stdin.write('不存在');
    await nextRender();
    stdin.write('\r');
    await nextRender();

    expect(lastFrame()).toContain('期初結餘');
    expect(lastFrame()).toContain('尚無交易紀錄');
    stdin.write('f');
    await nextRender();
    for (let index = 0; index < 4; index += 1) {
      stdin.write('1');
      await nextRender();
    }
    expect(lastFrame()).not.toContain('期初結餘');
  });

  it('shows nonzero carryover while arrows select only current-semester transactions', async () => {
    const semesterSettings: LedgerSettings = {
      ...settings,
      semesters: [
        {value: '第一學期', status: 'active'},
        {value: '第二學期', status: 'active'},
      ],
    };
    const semesterTransactions = [
      {...transactions[0]!, semester: '第二學期'},
      transactions[1]!,
      {...transactions[2]!, semester: '第二學期'},
    ];
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repositoryWith({
          settings: semesterSettings,
          transactions: semesterTransactions,
        })}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('f');
    await nextRender();
    stdin.write('3');
    await nextRender();
    for (let index = 0; index < 3; index += 1) {
      stdin.write('1');
      await nextRender();
    }

    let openingLine = lastFrame()
      ?.split('\n')
      .find((line) => line.includes('期初結餘'));
    expect(openingLine).toContain('NT$5,000');
    expect(openingLine).not.toContain('›');
    expect(selectedLine(lastFrame())).toContain('影印');
    stdin.write('\u001b[B');
    await nextRender();
    openingLine = lastFrame()
      ?.split('\n')
      .find((line) => line.includes('期初結餘'));
    expect(openingLine).not.toContain('›');
    expect(selectedLine(lastFrame())).toContain('清潔用品');
  });

  it('clears a stale semester filter after repository reload changes settings', async () => {
    const semesterSettings: LedgerSettings = {
      ...settings,
      semesters: [
        {value: '第一學期', status: 'active'},
        {value: '第二學期', status: 'active'},
      ],
    };
    let repositoryState: LedgerState = {
      settings: semesterSettings,
      transactions,
    };
    const repository = {
      getState: vi.fn(() => structuredClone(repositoryState)),
      reload: vi.fn(async () => {
        repositoryState = {settings, transactions};
      }),
      saveSettings: vi.fn(),
      saveTransactions: vi.fn(),
    } as unknown as LedgerRepository;
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repository}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('f');
    await nextRender();
    stdin.write('3');
    await nextRender();
    for (let index = 0; index < 3; index += 1) {
      stdin.write('1');
      await nextRender();
    }
    expect(lastFrame()).toContain('學期 第二學期');
    expect(lastFrame()).toContain('期初結餘');
    stdin.write('/');
    await nextRender();
    stdin.write('影印');
    await nextRender();
    stdin.write('\r');
    await nextRender();
    expect(lastFrame()).toContain('搜尋 影印');

    stdin.write('p');
    await vi.waitFor(() => expect(repository.reload).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(lastFrame()).toContain('資料檢查通過'));
    stdin.write('\r');

    await vi.waitFor(() => expect(lastFrame()).toContain('篩選：搜尋 影印'));
    expect(lastFrame()).not.toContain('學期 第二學期');
    expect(lastFrame()).not.toContain('期初結餘');
  });

  it('reacts to terminal resize events by switching table layouts', async () => {
    const fakeRepository = repositoryWith({settings, transactions});
    const rendered = render(
      <App
        root="/ledger"
        repository={fakeRepository}
        setupComplete
        onExit={vi.fn()}
      />,
    );
    let columns = 100;
    Object.defineProperty(rendered.stdout, 'columns', {
      configurable: true,
      get: () => columns,
    });

    expect(rendered.lastFrame()).toContain('數學講義');
    expect(rendered.lastFrame()).toContain('教材與影印');

    columns = 60;
    rendered.stdout.emit('resize');
    await vi.waitFor(() => {
      expect(rendered.lastFrame()).not.toContain('數學講義');
      expect(rendered.lastFrame()).not.toContain('教材與影印');
    });
    expect(rendered.lastFrame()).toContain('2026-09-02');
    expect(rendered.lastFrame()).toContain('NT$300');
  });
});

describe('TransactionTable layout', () => {
  const rows = createLedgerView(transactions, {...emptyFilter}).rows;

  it('keeps the date and amount visible while hiding detail columns when narrow', () => {
    const {lastFrame} = render(
      <TransactionTable rows={rows} selectedIndex={0} width={60} />,
    );

    expect(lastFrame()).toContain('2026-09-02');
    expect(lastFrame()).toContain('NT$300');
    expect(lastFrame()).not.toContain('數學講義');
    expect(lastFrame()).not.toContain('教材與影印');
  });

  it('shows category and note columns at a wide width with stable selection width', () => {
    const first = render(
      <TransactionTable rows={rows} selectedIndex={0} width={120} />,
    );
    const firstWidth = frameWidth(first.lastFrame());

    expect(first.lastFrame()).toContain('教材與影印');
    expect(first.lastFrame()).toContain('數學講義');

    first.rerender(
      <TransactionTable rows={rows} selectedIndex={2} width={120} />,
    );
    expect(selectedLine(first.lastFrame())).toContain('期初');
    expect(frameWidth(first.lastFrame())).toBe(firstWidth);
  });

  it('renders a blue-equivalent opening balance row before transactions without selecting it', () => {
    const {lastFrame} = render(
      <TransactionTable
        rows={rows}
        selectedIndex={0}
        width={120}
        openingBalance={-500}
      />,
    );
    const lines = lastFrame()!.split('\n');

    expect(lines[1]).toContain('期初結餘');
    expect(lines[1]).toContain('-NT$500');
    expect(lines[1]).not.toContain('›');
    expect(selectedLine(lastFrame())).toContain('影印');
  });

  it.each([0, -500])(
    'renders an opening balance of %i when transaction rows are empty',
    (openingBalance) => {
      const {lastFrame} = render(
        <TransactionTable
          rows={[]}
          selectedIndex={0}
          width={60}
          openingBalance={openingBalance}
        />,
      );

      expect(lastFrame()).toContain('期初結餘');
      expect(lastFrame()).toContain(
        openingBalance === 0 ? 'NT$0' : '-NT$500',
      );
      expect(lastFrame()).toContain('尚無交易紀錄');
    },
  );

  it.each([40, 24])(
    'keeps the opening balance within ultra-compact width %i',
    (width) => {
      const {lastFrame} = render(
        <TransactionTable
          rows={rows}
          selectedIndex={0}
          width={width}
          openingBalance={0}
        />,
      );

      expect(lastFrame()).toContain('NT$0');
      for (const line of (lastFrame() ?? '').split('\n')) {
        expect(terminalWidth(line)).toBeLessThanOrEqual(width);
      }
    },
  );

  it('normalizes note line feeds into one physical table row', () => {
    const transaction = {
      ...transactions[0]!,
      note: '第一行\n第二行',
    };
    const noteRows = createLedgerView([transaction], {...emptyFilter}).rows;
    const {lastFrame} = render(
      <TransactionTable rows={noteRows} selectedIndex={0} width={120} />,
    );

    expect(lastFrame()?.split('\n')).toHaveLength(2);
    expect(lastFrame()).toContain('第一行 第二行');
    expect(transaction.note).toBe('第一行\n第二行');
  });

  it('fits the category and note threshold within exactly 80 columns', () => {
    const {lastFrame} = render(
      <TransactionTable rows={rows} selectedIndex={0} width={80} />,
    );

    expect(lastFrame()).toContain('分類');
    expect(lastFrame()).toContain('備');
    expect(
      Math.max(...(lastFrame() ?? '').split('\n').map(terminalWidth)),
    ).toBeLessThanOrEqual(80);
  });

  it.each([40, 24])(
    'never exceeds an ultra-compact width of %i columns',
    (width) => {
      const table = render(
        <TransactionTable rows={rows} selectedIndex={0} width={width} />,
      );
      const initialSelection = selectedLine(table.lastFrame());

      expect(table.lastFrame()).toContain('2026-09-02');
      expect(table.lastFrame()).toContain('NT$300');
      expect(initialSelection).toBeDefined();
      for (const line of (table.lastFrame() ?? '').split('\n')) {
        expect(terminalWidth(line)).toBeLessThanOrEqual(width);
      }

      table.rerender(
        <TransactionTable rows={rows} selectedIndex={2} width={width} />,
      );
      const nextSelection = selectedLine(table.lastFrame());
      expect(nextSelection).toBeDefined();
      expect(terminalWidth(nextSelection!)).toBe(
        terminalWidth(initialSelection!),
      );
      for (const line of (table.lastFrame() ?? '').split('\n')) {
        expect(terminalWidth(line)).toBeLessThanOrEqual(width);
      }
    },
  );

  it.each([46, 79])(
    'keeps compact reserved column widths stable at width %i',
    (width) => {
      const {lastFrame} = render(
        <TransactionTable rows={rows} selectedIndex={0} width={width} />,
      );
      const otherOfficer = lastFrame()
        ?.split('\n')
        .find((line) => line.includes('NT$700'));

      expect(otherOfficer).toContain('另…');
      expect(otherOfficer).not.toContain('另一');
    },
  );

  it('shrinks both date and amount deterministically at five columns', () => {
    const {lastFrame} = render(
      <TransactionTable rows={rows} selectedIndex={0} width={5} />,
    );
    const selection = selectedLine(lastFrame());

    expect(selection?.match(/…/g)).toHaveLength(2);
    for (const line of (lastFrame() ?? '').split('\n')) {
      expect(terminalWidth(line)).toBeLessThanOrEqual(5);
    }
  });

  it('renders nothing when no terminal columns are available', () => {
    const {lastFrame} = render(
      <TransactionTable rows={rows} selectedIndex={0} width={0} />,
    );

    expect(lastFrame() ?? '').toBe('');
  });
});

describe('recovery placeholder', () => {
  it('renders typed inspection issues without requiring a repository', () => {
    const inspection: LedgerInspection = {
      root: '/ledger',
      settingsText: '{broken',
      transactionsText: null,
      state: null,
      issues: [
        {source: 'settings', field: 'json', message: 'Malformed JSON'},
      ],
    };
    const {lastFrame} = render(
      <App
        root="/ledger"
        inspection={inspection}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('班費帳本');
    expect(lastFrame()).toContain('只能讀取');
    expect(lastFrame()).toContain('設定 / json：JSON 格式錯誤');
    expect(lastFrame()).not.toContain('Malformed JSON');
  });
});
