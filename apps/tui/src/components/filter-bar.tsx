import {Text} from 'ink';

import type {LedgerFilter} from '@class-fund/ledger';

export interface FilterBarProps {
  filter: LedgerFilter;
}

export function FilterBar({filter}: FilterBarProps) {
  const active = [
    filter.semester === null ? null : `學期 ${filter.semester}`,
    filter.category === null ? null : `分類 ${filter.category}`,
    filter.handledBy === null ? null : `經手人 ${filter.handledBy}`,
    filter.type === null
      ? null
      : `類型 ${filter.type === 'income' ? '收入' : '支出'}`,
    filter.search.trim() === '' ? null : `搜尋 ${filter.search.trim()}`,
  ].filter((value): value is string => value !== null);

  return <Text>篩選：{active.length === 0 ? '全部交易' : active.join('  ')}</Text>;
}
