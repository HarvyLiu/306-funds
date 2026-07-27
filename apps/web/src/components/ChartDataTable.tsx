import {useId, useState} from 'react';

interface Column<Row> {
  key: keyof Row;
  heading: string;
  align?: 'left' | 'right';
}

interface ChartDataTableProps<Row extends {key: string}> {
  label: string;
  columns: Array<Column<Row>>;
  rows: Row[];
}

export function ChartDataTable<Row extends {key: string}>({
  label,
  columns,
  rows,
}: ChartDataTableProps<Row>) {
  const [open, setOpen] = useState(false);
  const tableId = useId();

  return (
    <div className="chart-data">
      <button
        type="button"
        className="chart-data-toggle"
        aria-expanded={open}
        aria-controls={tableId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? '隱藏資料表' : '查看資料表'}
      </button>
      {open ? (
        <div className="chart-data-scroll">
          <table id={tableId} aria-label={label}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={String(column.key)}
                    scope="col"
                    className={
                      column.align === 'right' ? 'amount-column' : undefined
                    }
                  >
                    {column.heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  {columns.map((column) => (
                    <td
                      key={String(column.key)}
                      className={
                        column.align === 'right' ? 'amount-column' : undefined
                      }
                    >
                      {String(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
