import {Box, Text} from 'ink';

import {formatTwd, type Totals} from '@class-fund/ledger';

export interface SummaryProps {
  overall: Totals;
  filtered: Totals;
  hasFilters: boolean;
}

export function Summary({overall, filtered, hasFilters}: SummaryProps) {
  return (
    <Box flexDirection="column">
      <Text bold>目前總餘額  {formatTwd(overall.net)}</Text>
      <Text>
        總收入 {formatTwd(overall.income)}  總支出 {formatTwd(overall.expenses)}
      </Text>
      {hasFilters ? (
        <Text>
          篩選小計 {formatTwd(filtered.net)}  收入 {formatTwd(filtered.income)}  支出{' '}
          {formatTwd(filtered.expenses)}
        </Text>
      ) : null}
    </Box>
  );
}
