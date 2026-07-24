import type {LedgerIssue} from '@class-fund/ledger';

const localizedReasons: Readonly<Record<string, string>> = {
  'Active semester cannot be archived': '目前學期不可封存',
  'Added transaction could not be resolved': '無法確認新增的交易',
  'Amount must be a positive whole number': '金額必須是正整數',
  'CSV header must match the canonical order': 'CSV 欄位順序不正確',
  'Category is not configured': '分類不在設定中',
  'Category must be text': '分類必須是文字',
  'Control characters are not permitted in this field':
    '欄位含有不允許的控制字元',
  'Could not serialize CSV': '無法產生 CSV 內容',
  'Created timestamp must be ISO-8601 with a numeric offset':
    '建立時間必須是含數字時區的 ISO-8601 格式',
  'Date must be a real YYYY-MM-DD date':
    '日期必須是有效的 YYYY-MM-DD 日期',
  'Default officer cannot be archived': '預設經手人不可封存',
  'Edited transaction could not be resolved': '無法確認編輯後的交易',
  'ID must be a lowercase UUID': 'ID 必須是小寫 UUID',
  'Ledger calculation exceeds the safe integer range': '帳本金額超出安全計算範圍',
  'Ledger file is missing': '找不到帳本檔案',
  'Malformed CSV': 'CSV 格式錯誤',
  'Malformed JSON': 'JSON 格式錯誤',
  'Note must be text': '備註必須是文字',
  'Officer is not configured': '經手人不在設定中',
  'Officer must be text': '經手人必須是文字',
  'Option group is not supported': '不支援此設定群組',
  'Option is already archived': '此選項已封存',
  'Option is not configured': '此選項不在設定中',
  'Option value is already configured': '此選項已存在',
  'Option values must be unique': '選項不可重複',
  'Referenced option cannot be archived': '已被交易引用的選項不可封存',
  'Semester is not configured': '學期不在設定中',
  'Semester must be text': '學期必須是文字',
  'Settings could not be inspected': '無法檢查設定內容',
  'Subject must not be blank': '項目不可空白',
  'Transaction IDs must be unique': '交易 ID 不可重複',
  'Transaction input could not be inspected': '無法檢查交易輸入',
  'Transaction must be an object': '交易資料必須是物件',
  'Transaction target is ambiguous': '無法唯一識別目標交易',
  'Transaction was not found': '找不到目標交易',
  'Transactions could not be inspected': '無法檢查交易資料',
  'Type must be income or expense': '類型必須是收入或支出',
  'Unknown settings key': '設定包含未知欄位',
  'Value must not be empty': '值不可空白',
  'Value must not have leading or trailing whitespace': '值的前後不可有空格',
  'Value must reference an active option': '值必須指向啟用中的選項',
};

export function localizeLedgerIssueReason(message: string): string {
  const localized = localizedReasons[message];
  if (localized !== undefined) return localized;
  if (/^Ledger file could not be read \([A-Z0-9_]+\)$/.test(message)) {
    return '無法讀取帳本檔案';
  }
  if (/^Backup file could not be read \([A-Z0-9_]+\)$/.test(message)) {
    return '無法讀取備份檔案';
  }
  return '資料內容不符合規則';
}

function rejectedValue(value: unknown): string {
  try {
    return String(value).replaceAll('\r', '\\r').replaceAll('\n', '\\n');
  } catch {
    return '無法顯示';
  }
}

export function formatLedgerIssue(
  issue: LedgerIssue,
  includeRejectedValue = false,
): string {
  const source = issue.source === 'settings' ? '設定' : '交易';
  const row = issue.row === undefined ? '' : ` / 第 ${issue.row} 列`;
  const reason = localizeLedgerIssueReason(issue.message);
  const summary = `${source}${row} / ${issue.field}：${reason}`;

  if (!includeRejectedValue || issue.value === undefined) return summary;
  return `${summary}\n拒絕值：${rejectedValue(issue.value)}`;
}

export function formatLedgerIssues(
  issues: readonly LedgerIssue[],
  includeRejectedValues = false,
): string {
  return issues
    .map((issue) => formatLedgerIssue(issue, includeRejectedValues))
    .join('\n');
}
