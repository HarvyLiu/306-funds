import type {LedgerSettings} from '../src/types.js';

export const validSettings: LedgerSettings = {
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
  ],
  officers: [
    {value: '我', status: 'active'},
    {value: '另一位總務', status: 'active'},
  ],
};
