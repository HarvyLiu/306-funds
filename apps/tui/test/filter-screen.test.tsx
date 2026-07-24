import type {LedgerSettings, LedgerState, Transaction} from '@class-fund/ledger';
import type {LedgerRepository} from '@class-fund/ledger/node';
import {cleanup, render} from 'ink-testing-library';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {App} from '../src/app.js';

const settings: LedgerSettings = {
  schema_version: 1,
  currency: 'TWD',
  active_semester: '第一學期',
  default_officer: '我',
  semesters: [
    {value: '第一學期', status: 'active'},
    {value: '第二學期', status: 'active'},
  ],
  categories: [
    {value: '期初餘額', status: 'active'},
    {value: '教材與影印', status: 'active'},
    {value: '清潔用品', status: 'archived'},
  ],
  officers: [
    {value: '我', status: 'active'},
    {value: '另一位總務', status: 'active'},
  ],
};

const transactions: Transaction[] = [
  {
    id: 'opening',
    date: '2026-08-01',
    semester: '第一學期',
    subject: '期初班費',
    category: '期初餘額',
    type: 'income',
    amount: 5000,
    handled_by: '我',
    note: '',
    created_at: '2026-08-01T08:00:00+08:00',
  },
  {
    id: 'copies',
    date: '2026-08-17',
    semester: '第一學期',
    subject: '影印講義',
    category: '教材與影印',
    type: 'expense',
    amount: 600,
    handled_by: '我',
    note: '班會資料',
    created_at: '2026-08-17T10:00:00+08:00',
  },
  {
    id: 'cleaning',
    date: '2026-09-01',
    semester: '第二學期',
    subject: '清潔用品',
    category: '清潔用品',
    type: 'expense',
    amount: 400,
    handled_by: '另一位總務',
    note: '影印收據背面有註記',
    created_at: '2026-09-01T10:00:00+08:00',
  },
];

function repositoryWith(state: LedgerState): LedgerRepository {
  return {
    getState: vi.fn(() => structuredClone(state)),
    reload: vi.fn(),
    saveSettings: vi.fn(),
    saveTransactions: vi.fn(),
  } as unknown as LedgerRepository;
}

async function nextRender(): Promise<void> {
  await new Promise<void>((done) => setImmediate(done));
}

afterEach(() => cleanup());

describe('overview filters and search', () => {
  it('selects all four filters, preserves overall balance, and clears each with 全部', async () => {
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repositoryWith({settings, transactions})}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('f');
    await nextRender();
    stdin.write('2');
    await nextRender();
    stdin.write('2');
    await nextRender();
    expect(lastFrame()).toContain('清潔用品');
    stdin.write('3');
    await nextRender();
    stdin.write('3');
    await nextRender();

    expect(lastFrame()).toContain('學期 第一學期');
    expect(lastFrame()).toContain('經手人 我');
    expect(lastFrame()).toContain('分類 教材與影印');
    expect(lastFrame()).toContain('類型 支出');
    expect(lastFrame()).toContain('影印講義');
    expect(lastFrame()).not.toContain('清潔用品');
    expect(lastFrame()).not.toContain('期初班費');
    expect(lastFrame()).toContain('目前總餘額  NT$4,000');
    expect(lastFrame()).toContain('篩選小計 -NT$600');

    stdin.write('f');
    await nextRender();
    for (let index = 0; index < 4; index += 1) {
      stdin.write('1');
      await nextRender();
    }

    expect(lastFrame()).toContain('篩選：全部交易');
    expect(lastFrame()).toContain('影印講義');
    expect(lastFrame()).toContain('清潔用品');
    expect(lastFrame()).toContain('期初班費');
    expect(lastFrame()).not.toContain('篩選小計');
  });

  it('searches subject and note, then Escape clears the search', async () => {
    const {lastFrame, stdin} = render(
      <App
        root="/ledger"
        repository={repositoryWith({settings, transactions})}
        setupComplete
        onExit={vi.fn()}
      />,
    );

    stdin.write('/');
    await nextRender();
    stdin.write('影印');
    await nextRender();
    stdin.write('\r');
    await nextRender();

    expect(lastFrame()).toContain('搜尋 影印');
    expect(lastFrame()).toContain('影印講義');
    expect(lastFrame()).toContain('清潔用品');
    expect(lastFrame()).not.toContain('期初班費');
    expect(lastFrame()).toContain('目前總餘額  NT$4,000');
    expect(lastFrame()).toContain('篩選小計 -NT$1,000');

    stdin.write('\u001b[27u');
    await nextRender();
    expect(lastFrame()).toContain('篩選：全部交易');
    expect(lastFrame()).toContain('期初班費');
  });
});
