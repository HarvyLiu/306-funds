import {formatTwd} from '@class-fund/ledger/format';

import type {ReportPayload} from '../lib/load-report.js';

interface ReportAppProps {
  payload: ReportPayload;
}

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

export function ReportApp({payload}: ReportAppProps) {
  return (
    <main className="report-shell">
      <header className="report-header">
        <h1>班費收支報告</h1>
        <p className="updated-at">
          <span>資料更新時間</span>
          <time dateTime={payload.generatedAt}>
            {generatedAtFormatter.format(new Date(payload.generatedAt))}
          </time>
        </p>
      </header>

      <section className="summary-band" aria-label="帳務摘要">
        <dl>
          <div className="summary-primary">
            <dt>目前總餘額</dt>
            <dd>{formatTwd(payload.view.overall.net)}</dd>
          </div>
          <div>
            <dt>總收入</dt>
            <dd className="amount-income">
              {formatTwd(payload.view.overall.income)}
            </dd>
          </div>
          <div>
            <dt>總支出</dt>
            <dd className="amount-expense">
              {formatTwd(payload.view.overall.expenses)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="transactions" aria-labelledby="transactions-title">
        <h2 id="transactions-title">交易明細</h2>
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
              {payload.view.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-row">
                    目前沒有交易紀錄
                  </td>
                </tr>
              ) : (
                payload.view.rows.map(({transaction, runningBalance}) => (
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
