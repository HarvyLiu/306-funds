import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';

import {ChartDataTable} from '../src/components/ChartDataTable.js';

const columns = [
  {key: 'subject' as const, heading: '項目'},
  {key: 'balance' as const, heading: '餘額', align: 'right' as const},
];

const rows = [
  {key: 'opening', subject: '期初結餘', balance: 'NT$4,000'},
];

describe('ChartDataTable', () => {
  it('reveals and hides an exact semantic data table', async () => {
    const user = userEvent.setup();
    render(
      <ChartDataTable
        label="總餘額走勢資料"
        columns={columns}
        rows={rows}
      />,
    );

    const button = screen.getByRole('button', {name: '查看資料表'});
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('table', {name: '總餘額走勢資料'}),
    ).not.toBeInTheDocument();

    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByRole('table', {name: '總餘額走勢資料'}),
    ).toBeVisible();
    expect(screen.getByRole('cell', {name: 'NT$4,000'})).toBeVisible();

    await user.click(screen.getByRole('button', {name: '隱藏資料表'}));

    expect(
      screen.queryByRole('table', {name: '總餘額走勢資料'}),
    ).not.toBeInTheDocument();
  });

  it('uses a unique disclosure target for each table', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ChartDataTable label="收入資料" columns={columns} rows={rows} />
        <ChartDataTable label="支出資料" columns={columns} rows={rows} />
      </>,
    );

    const buttons = screen.getAllByRole('button', {name: '查看資料表'});
    const targetIds = buttons.map((button) =>
      button.getAttribute('aria-controls'),
    );
    expect(targetIds[0]).toBeTruthy();
    expect(targetIds[1]).toBeTruthy();
    expect(targetIds[0]).not.toBe(targetIds[1]);

    await user.click(buttons[0]!);
    await user.click(buttons[1]!);

    expect(screen.getByRole('table', {name: '收入資料'})).toHaveAttribute(
      'id',
      targetIds[0],
    );
    expect(screen.getByRole('table', {name: '支出資料'})).toHaveAttribute(
      'id',
      targetIds[1],
    );
  });

  it('marks column headings and right-aligns numeric columns', async () => {
    const user = userEvent.setup();
    render(
      <ChartDataTable
        label="總餘額走勢資料"
        columns={columns}
        rows={rows}
      />,
    );

    await user.click(screen.getByRole('button', {name: '查看資料表'}));

    const table = screen.getByRole('table', {name: '總餘額走勢資料'});
    const subjectHeading = within(table).getByRole('columnheader', {
      name: '項目',
    });
    const balanceHeading = within(table).getByRole('columnheader', {
      name: '餘額',
    });
    expect(subjectHeading).toHaveAttribute('scope', 'col');
    expect(subjectHeading).not.toHaveClass('amount-column');
    expect(balanceHeading).toHaveAttribute('scope', 'col');
    expect(balanceHeading).toHaveClass('amount-column');
    expect(within(table).getByRole('cell', {name: 'NT$4,000'})).toHaveClass(
      'amount-column',
    );
  });
});
