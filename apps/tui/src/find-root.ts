import {realpathSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

export class LedgerRootNotFoundError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`找不到班費帳本資料根目錄：${path}`);
    this.name = 'LedgerRootNotFoundError';
    this.path = path;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function findLedgerRoot(start: string): string {
  const resolvedStart = resolve(start);
  let physicalStart: string;

  try {
    physicalStart = realpathSync(resolvedStart);
  } catch {
    throw new LedgerRootNotFoundError(resolvedStart);
  }

  let candidate = isFile(physicalStart) ? dirname(physicalStart) : physicalStart;

  while (true) {
    const hasSettings = isFile(join(candidate, 'data/settings.json'));
    const hasTransactions = isFile(join(candidate, 'data/transactions.csv'));
    if (hasSettings && hasTransactions) {
      return candidate;
    }

    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new LedgerRootNotFoundError(resolvedStart);
    }
    candidate = parent;
  }
}
