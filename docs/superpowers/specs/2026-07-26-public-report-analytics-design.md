# Public Report Analytics

## Goal

Turn the public class-fund report into a useful analytics view without changing
the ledger's accounting rules. Add an interactive balance timeline, income and
expense doughnuts, semester comparison, and a list of the largest transactions.
Every visualization must remain understandable on mobile and without relying
on pointer hover.

## Scope

The selected dashboard contains:

1. `總餘額走勢`
2. `分類支出比例`
3. `分類收入比例`
4. `各學期收支比較`
5. `主要收支變動`

The existing summary, filters, and transaction table remain the report's main
controls and detailed source of truth.

## Architecture

The ledger package provides pure analytics functions and typed results. The
functions accept settings, transactions, and the existing `LedgerFilter` and
return chart-ready values without mutating their inputs. React components own
layout and interaction. Chart.js, which the web app already uses, renders the
line, doughnut, and bar charts.

The analytics layer reuses transaction ordering, safe-integer arithmetic,
filter matching, semester order, and semester opening-balance calculations.
The web app does not duplicate accounting calculations.

No repository or persisted-data format changes belong to this feature. The
separate semester carryover design supplies settings schema version 2 and the
opening-balance calculation used here.

## Filter Semantics

Income and expense doughnuts, comparison bars, and largest transactions use
transactions that match all current filters. A type filter can therefore leave
the opposite doughnut empty. Date display order affects only the transaction
table.

The balance line always represents the real ledger balance:

- With no semester filter, it contains every transaction in chronological
  order.
- With a semester filter, it starts at that semester's derived opening balance
  and contains every transaction from that semester.
- Category, officer, type, and search filters mark matching points for emphasis
  and dim other points. They do not recalculate a fictional partial balance.

This distinction appears in chart labels, tooltips, and accessible data tables.

## Balance Timeline

`總餘額走勢` uses one point per transaction. Each point contains the
transaction ID, date, subject, signed amount, resulting balance, and whether it
matches the current secondary filters. Multiple transactions on one date remain
separate and follow the ledger's existing date, creation-time, and ID ordering.

When a semester is selected, the chart prepends a read-only `期初結餘` point.
The point has no transaction ID and cannot link to a transaction row. Positive,
zero, and negative balances use the same scale.

Hover or tap shows the date, item, signed amount, and resulting balance. A
matching point also uses shape or emphasis in addition to color. The chart does
not animate when the user requests reduced motion.

## Category Doughnuts

The report shows separate income and expense doughnuts. Each groups matching
transactions by category and calculates:

- integer total amount;
- transaction count;
- percentage of the matching income or expense total.

The five largest categories receive slices. Remaining categories combine into
`其他`; its tooltip and data table identify it as a grouped value. Stable amount
and category-name ordering resolves ties. Amounts remain authoritative, while
display percentages use bounded rounding.

The two charts share a stable, multi-color category palette. Income and expense
meaning also appears in headings and labels, so color does not carry that
meaning alone. Hover, tap, or the data table exposes category, amount,
percentage, and transaction count.

## Semester Comparison

`各學期收支比較` follows `settings.semesters` order. A semester filter reduces
the chart to that semester. Other filters affect the income and expense bars.

Each semester displays:

- filtered income and expense bars;
- actual opening balance;
- actual ending balance.

Opening and ending balances stay literal even when a category, officer, type,
or search filter narrows the bars. Tooltips and the data table label filtered
activity and actual balances separately.

## Largest Transactions

`主要收支變動` lists the five matching transactions with the largest absolute
amounts. Ties use newest date, newest valid creation time, then transaction ID.
Each item shows date, subject, category, and signed amount.

Activating an item scrolls to its transaction-table row, moves keyboard focus
to that row, and applies a short non-color-only highlight. The interaction
respects reduced motion. Empty filtered results show a local empty state.

## Layout

The analytics section sits between the summary and transaction table:

1. full-width balance timeline;
2. side-by-side expense and income doughnuts;
3. semester comparison beside largest transactions.

Mobile layouts stack those sections in the same order. Chart regions use
stable responsive dimensions so loading, empty states, tooltips, and legends do
not shift surrounding content. The visual palette uses blue for balance, green
for income, red for expense, and varied category colors.

The current `分類支出` bar chart is replaced by the two doughnuts rather than
kept as a duplicate view.

## Accessibility and Failure Handling

Every canvas has a concise accessible name. Each chart provides a
`查看資料表` control that reveals the exact values in semantic HTML. Keyboard
and screen-reader users can inspect every value without depending on canvas or
hover behavior.

Chart components catch Chart.js initialization failures, leave the HTML data
table available, and keep the summary and transaction report usable. Empty
states name the missing data, such as `目前沒有收入資料`.

The report displays only fields already present in the public transaction
table. Tooltips and data tables do not expose new repository metadata.

## Tests

Ledger unit tests cover:

- chronological balance points and same-day ordering;
- semester opening points and true running balances;
- filter emphasis without balance recalculation;
- income and expense grouping, counts, percentages, `其他`, and stable ties;
- semester opening, filtered activity, and actual ending values;
- largest-transaction ordering and stable ties;
- empty, single-category, zero, and negative-balance cases;
- immutability and safe-integer failures.

Web component tests cover Chart.js configuration, cleanup, filter rerenders,
empty states, data-table controls, and failure fallback. Browser tests cover
hover and tap details, keyboard access, transaction-row focus and highlighting,
mobile stacking, reduced motion, and interactions with every existing filter.

The release gate includes unit tests, browser tests, typecheck, the static
production build, GitHub Pages base-path behavior, and desktop and mobile visual
captures with representative fixture data.

## Out of Scope

- Forecasting or anomaly detection
- Budgets and budget variance
- Calendar heatmaps
- Officer rankings
- Editing data from the public report
- New server-side analytics or tracking
