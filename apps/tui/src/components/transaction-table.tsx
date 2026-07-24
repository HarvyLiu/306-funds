import {Box, Text} from 'ink';
import cliTruncate from 'cli-truncate';

import {formatTwd, type LedgerRow} from '@class-fund/ledger';

export interface TransactionTableProps {
  rows: LedgerRow[];
  selectedIndex: number;
  width: number;
}

type ColumnKey =
  | 'date'
  | 'type'
  | 'subject'
  | 'category'
  | 'officer'
  | 'amount'
  | 'balance'
  | 'note';

interface Column {
  key: ColumnKey;
  heading: string;
  width: number;
  align: 'left' | 'right';
}

interface TableLayout {
  markerWidth: number;
  columns: Column[];
}

function detailedLayout(width: number): TableLayout {
  const flexibleWidth = width - 73;
  const subjectWidth = Math.max(4, Math.floor(flexibleWidth * 0.6));
  const noteWidth = flexibleWidth - subjectWidth;
  return {
    markerWidth: 2,
    columns: [
      {key: 'date', heading: '日期', width: 10, align: 'left'},
      {key: 'type', heading: '類型', width: 4, align: 'left'},
      {key: 'subject', heading: '項目', width: subjectWidth, align: 'left'},
      {key: 'category', heading: '分類', width: 12, align: 'left'},
      {key: 'officer', heading: '經手人', width: 10, align: 'left'},
      {key: 'amount', heading: '金額', width: 14, align: 'right'},
      {key: 'balance', heading: '餘額', width: 14, align: 'right'},
      {key: 'note', heading: '備註', width: noteWidth, align: 'left'},
    ],
  };
}

function compactLayout(width: number): TableLayout {
  return {
    markerWidth: 2,
    columns: [
      {key: 'date', heading: '日期', width: 10, align: 'left'},
      {key: 'type', heading: '類型', width: 4, align: 'left'},
      {key: 'subject', heading: '項目', width: width - 45, align: 'left'},
      {key: 'officer', heading: '經手人', width: 4, align: 'left'},
      {key: 'amount', heading: '金額', width: 10, align: 'right'},
      {key: 'balance', heading: '餘額', width: 10, align: 'right'},
    ],
  };
}

function ultraCompactLayout(width: number): TableLayout {
  const markerWidth = width >= 3 ? 2 : width >= 2 ? 1 : 0;
  const available = width - markerWidth;

  if (available <= 0) {
    return {markerWidth, columns: []};
  }

  if (width >= 25) {
    return {
      markerWidth,
      columns: [
        {key: 'date', heading: '日期', width: 10, align: 'left'},
        {key: 'subject', heading: '項目', width: width - 24, align: 'left'},
        {key: 'amount', heading: '金額', width: 10, align: 'right'},
      ],
    };
  }

  if (available < 3) {
    return {
      markerWidth,
      columns: [
        {key: 'amount', heading: '金額', width: available, align: 'right'},
      ],
    };
  }

  const columnBudget = available - 1;
  const dateWidth =
    columnBudget >= 16
      ? 10
      : Math.max(1, Math.floor(columnBudget * 0.55));
  return {
    markerWidth,
    columns: [
      {key: 'date', heading: '日期', width: dateWidth, align: 'left'},
      {
        key: 'amount',
        heading: '金額',
        width: columnBudget - dateWidth,
        align: 'right',
      },
    ],
  };
}

function layoutFor(width: number): TableLayout {
  if (width >= 80) {
    return detailedLayout(width);
  }
  return width >= 46 ? compactLayout(width) : ultraCompactLayout(width);
}

function valueFor(row: LedgerRow, key: ColumnKey): string {
  const transaction = row.transaction;
  switch (key) {
    case 'date':
      return transaction.date;
    case 'type':
      return transaction.type === 'income' ? '收入' : '支出';
    case 'subject':
      return transaction.subject;
    case 'category':
      return transaction.category;
    case 'officer':
      return transaction.handled_by;
    case 'amount':
      return formatTwd(transaction.amount);
    case 'balance':
      return formatTwd(row.runningBalance);
    case 'note':
      return transaction.note;
  }
}

function TableLine({
  columns,
  markerWidth,
  marker,
  values,
}: {
  columns: Column[];
  markerWidth: number;
  marker: string;
  values: Record<ColumnKey, string>;
}) {
  return (
    <Box>
      {markerWidth > 0 ? (
        <Box width={markerWidth} flexShrink={0}>
          <Text>{markerWidth === 1 ? marker.trimEnd() : marker}</Text>
        </Box>
      ) : null}
      {columns.map((column, index) => {
        const displayValue =
          column.key === 'note'
            ? values[column.key].replace(/\r\n|\r|\n/g, ' ')
            : values[column.key];
        const value = cliTruncate(displayValue, column.width, {
          position:
            column.key === 'amount' || column.key === 'balance'
              ? 'start'
              : 'end',
        });
        return (
          <Box
            key={column.key}
            width={column.width}
            flexShrink={0}
            marginRight={index === columns.length - 1 ? 0 : 1}
            justifyContent={column.align === 'right' ? 'flex-end' : 'flex-start'}
          >
            <Text>{value}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function TransactionTable({
  rows,
  selectedIndex,
  width,
}: TransactionTableProps) {
  const safeWidth = Number.isFinite(width)
    ? Math.max(0, Math.floor(width))
    : 0;
  if (safeWidth === 0) return null;

  const {columns, markerWidth} = layoutFor(safeWidth);
  const headings = Object.fromEntries(
    columns.map((column) => [column.key, column.heading]),
  ) as Record<ColumnKey, string>;

  return (
    <Box flexDirection="column" width={safeWidth}>
      <TableLine
        columns={columns}
        markerWidth={markerWidth}
        marker="  "
        values={headings}
      />
      {rows.length === 0 ? (
        <Text>{cliTruncate('  尚無交易紀錄', safeWidth)}</Text>
      ) : (
        rows.map((row, index) => (
          <TableLine
            key={row.transaction.id}
            columns={columns}
            markerWidth={markerWidth}
            marker={index === selectedIndex ? '› ' : '  '}
            values={{
              date: valueFor(row, 'date'),
              type: valueFor(row, 'type'),
              subject: valueFor(row, 'subject'),
              category: valueFor(row, 'category'),
              officer: valueFor(row, 'officer'),
              amount: valueFor(row, 'amount'),
              balance: valueFor(row, 'balance'),
              note: valueFor(row, 'note'),
            }}
          />
        ))
      )}
    </Box>
  );
}
