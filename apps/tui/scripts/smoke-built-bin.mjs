import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entryPoint = join(packageRoot, 'dist/main.js');
const bundle = await readFile(entryPoint, 'utf8');

assert.doesNotMatch(
  bundle,
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']@class-fund\/ledger(?:\/[^"']*)?["']/u,
  'built TUI must not retain external @class-fund/ledger imports',
);

const temporaryRoot = await mkdtemp(join(tmpdir(), 'class-fund-tui-smoke-'));

try {
  const result = spawnSync(
    process.execPath,
    ['--no-experimental-strip-types', entryPoint],
    {
      cwd: temporaryRoot,
      encoding: 'utf8',
      env: {...process.env, INIT_CWD: temporaryRoot},
      timeout: 5_000,
    },
  );

  assert.ifError(result.error);
  assert.equal(result.signal, null, 'built TUI must exit without being killed');
  assert.equal(result.status, 1, 'missing ledger root must exit with status 1');
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    '無法啟動班費帳本，請確認資料路徑與檔案權限。\n',
  );
  assert.doesNotMatch(
    `${result.stdout}${result.stderr}`,
    /ERR_UNKNOWN_FILE_EXTENSION|packages[/\\]ledger[/\\]src/u,
  );
} finally {
  await rm(temporaryRoot, {recursive: true, force: true});
}
