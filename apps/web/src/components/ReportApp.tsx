import {useMemo, useState} from 'react';

import {
  createLedgerView,
  emptyFilter,
  type LedgerFilter,
} from '@class-fund/ledger/calculations';
import {formatTwd} from '@class-fund/ledger/format';

import type {ReportPayload} from '../lib/load-report.js';
import {ExpenseChart} from './ExpenseChart.js';

interface ReportAppProps {
  payload: ReportPayload;
}

type DateOrder = 'newest' | 'oldest';

const transactionDateFormatter = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  timeZone: 'UTC',
});

const generatedAtFormatter = new Intl.DateTimeFormat('zh-TW', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Asia/Taipei',
});

function formatTransactionDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return transactionDateFormatter.format(
    new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)),
  );
}

function uniqueValues(
  configured: readonly {value: string}[],
  referenced: readonly string[],
): string[] {
  return [...new Set([...configured.map(({value}) => value), ...referenced])];
}

export function ReportApp({payload}: ReportAppProps) {
  const [filter, setFilter] = useState<LedgerFilter>(() => ({...emptyFilter}));
  const [dateOrder, setDateOrder] = useState<DateOrder>('newest');

  const view = useMemo(
    () => createLedgerView(payload.transactions, filter),
    [filter, payload.transactions],
  );
  const rows = useMemo(
    () => (dateOrder === 'newest' ? view.rows : [...view.rows].reverse()),
    [dateOrder, view.rows],
  );
  const semesterOptions = useMemo(
    () =>
      uniqueValues(
        payload.settings.semesters,
        payload.transactions.map(({semester}) => semester),
      ),
    [payload.settings.semesters, payload.transactions],
  );
  const categoryOptions = useMemo(
    () =>
      uniqueValues(
        payload.settings.categories,
        payload.transactions.map(({category}) => category),
      ),
    [payload.settings.categories, payload.transactions],
  );
  const officerOptions = useMemo(
    () =>
      uniqueValues(
        payload.settings.officers,
        payload.transactions.map(({handled_by}) => handled_by),
      ),
    [payload.settings.officers, payload.transactions],
  );
  const hasFilter =
    filter.semester !== null ||
    filter.category !== null ||
    filter.handledBy !== null ||
    filter.type !== null ||
    filter.search.trim() !== '';

  return (
    <main className="report-shell">
      <header className="report-header">
        <div>
          <p className="report-kicker">班級公開帳本</p>
          <h1>班費收支報告</h1>
        </div>
        <p className="updated-at">
          <span>資料更新時間</span>
          <time dateTime={payload.generatedAt}>
            {generatedAtFormatter.format(new Date(payload.generatedAt))}
          </time>
        </p>
      </header>

      <section className="filter-panel" aria-labelledby="filter-title">
        <h2 id="filter-title">篩選與排序</h2>
        <div className="filter-grid">
          <label className="filter-field search-field">
            <span>搜尋項目與備註</span>
            <input
              type="search"
              value={filter.search}
              onChange={(event) =>
                setFilter((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
            />
          </label>
          <label className="filter-field">
            <span>學期</span>
            <select
              value={filter.semester ?? ''}
              onChange={(event) =>
                setFilter((current) => ({
                  ...current,
                  semester: event.target.value || null,
                }))
              }
            >
              <option value="">全部</option>
              {semesterOptions.map((semester) => (
                <option key={semester} value={semester}>
                  {semester}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>經手人</span>
            <select
              value={filter.handledBy ?? ''}
              onChange={(event) =>
                setFilter((current) => ({
                  ...current,
                  handledBy: event.target.value || null,
                }))
              }
            >
              <option value="">全部</option>
              {officerOptions.map((officer) => (
                <option key={officer} value={officer}>
                  {officer}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>分類</span>
            <select
              value={filter.category ?? ''}
              onChange={(event) =>
                setFilter((current) => ({
                  ...current,
                  category: event.target.value || null,
                }))
              }
            >
              <option value="">全部</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>類型</span>
            <select
              value={filter.type ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setFilter((current) => ({
                  ...current,
                  type:
                    value === 'income' || value === 'expense' ? value : null,
                }));
              }}
            >
              <option value="">全部</option>
              <option value="income">收入</option>
              <option value="expense">支出</option>
            </select>
          </label>
          <label className="filter-field">
            <span>日期排序</span>
            <select
              value={dateOrder}
              onChange={(event) => setDateOrder(event.target.value as DateOrder)}
            >
              <option value="newest">最新在前</option>
              <option value="oldest">最舊在前</option>
            </select>
          </label>
        </div>
      </section>

      <section className="summary-band" aria-label="帳務摘要">
        <dl>
          <div className="summary-primary">
            <dt>目前總餘額</dt>
            <dd>{formatTwd(view.overall.net)}</dd>
          </div>
          <div>
            <dt>總收入</dt>
            <dd className="amount-income">{formatTwd(view.overall.income)}</dd>
          </div>
          <div>
            <dt>總支出</dt>
            <dd className="amount-expense">
              {formatTwd(view.overall.expenses)}
            </dd>
          </div>
        </dl>
      </section>

      {hasFilter ? (
        <section className="filtered-summary" aria-label="篩選結果">
          <div className="section-heading">
            <h2>篩選結果</h2>
            <span>{view.rows.length} 筆交易</span>
          </div>
          <dl>
            <div>
              <dt>篩選收入</dt>
              <dd className="amount-income">
                {formatTwd(view.filtered.income)}
              </dd>
            </div>
            <div>
              <dt>篩選支出</dt>
              <dd className="amount-expense">
                {formatTwd(view.filtered.expenses)}
              </dd>
            </div>
            <div>
              <dt>篩選淨額</dt>
              <dd>{formatTwd(view.filtered.net)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="expense-chart" aria-labelledby="chart-title">
        <div className="section-heading">
          <h2 id="chart-title">分類支出</h2>
          <span>{hasFilter ? '篩選範圍' : '全部交易'}</span>
        </div>
        <ExpenseChart values={view.expensesByCategory} />
      </section>

      <section className="transactions" aria-labelledby="transactions-title">
        <div className="section-heading">
          <h2 id="transactions-title">交易明細</h2>
          <span>{rows.length} 筆</span>
        </div>
        <div className="table-scroll">
          <table aria-label="班費交易明細">
            <thead>
              <tr>
                <th scope="col">日期</th>
                <th scope="col">類型</th>
                <th scope="col">項目</th>
                <th scope="col">分類</th>
                <th scope="col">經手人</th>
                <th scope="col" className="amount-column">金額</th>
                <th scope="col" className="amount-column">餘額</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-row">
                    {hasFilter ? '沒有符合篩選條件的交易' : '目前沒有交易紀錄'}
                  </td>
                </tr>
              ) : (
                rows.map(({transaction, runningBalance}) => (
                  <tr key={transaction.id}>
                    <td>
                      <time dateTime={transaction.date}>
                        {formatTransactionDate(transaction.date)}
                      </time>
                    </td>
                    <td>
                      <span className={`type-label type-${transaction.type}`}>
                        {transaction.type === 'income' ? '收入' : '支出'}
                      </span>
                    </td>
                    <td>
                      <span className="subject">{transaction.subject}</span>
                      {transaction.note === '' ? null : (
                        <span className="note">{transaction.note}</span>
                      )}
                    </td>
                    <td>{transaction.category}</td>
                    <td>{transaction.handled_by}</td>
                    <td className="amount-column">
                      {formatTwd(transaction.amount)}
                    </td>
                    <td className="amount-column">
                      {formatTwd(runningBalance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default ReportApp;
