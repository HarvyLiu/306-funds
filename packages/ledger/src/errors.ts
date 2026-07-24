import type {LedgerIssue} from './types.js';

export class LedgerValidationError extends Error {
  readonly issues: LedgerIssue[];

  constructor(issues: LedgerIssue[]) {
    super('Ledger data validation failed');
    if (issues.length === 0) throw new TypeError('issues must not be empty');
    this.name = 'LedgerValidationError';
    const issuesCopy = [...issues];
    Object.freeze(issuesCopy);
    this.issues = issuesCopy;
  }
}

export class SourceConflictError extends Error {
  constructor(readonly path: string) {
    super(`Source changed: ${path}`);
    this.name = 'SourceConflictError';
  }
}

export class MissingBackupError extends Error {
  constructor(readonly path: string) {
    super(`Backup missing: ${path}`);
    this.name = 'MissingBackupError';
  }
}
