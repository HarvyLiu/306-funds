#!/usr/bin/env node

import {render} from 'ink';

import {inspectLedgerRoot, LedgerRepository} from '@class-fund/ledger/node';

import {App} from './app.js';
import {findLedgerRoot} from './find-root.js';
import {hasSetupMarker} from './setup-marker.js';

async function main(): Promise<void> {
  const root = findLedgerRoot(process.env.INIT_CWD ?? process.cwd());
  const [inspection, setupComplete] = await Promise.all([
    inspectLedgerRoot(root),
    hasSetupMarker(root),
  ]);

  let unmount = (): void => undefined;
  const onExit = (): void => unmount();

  const instance =
    inspection.state === null
      ? render(
          <App
            root={root}
            inspection={inspection}
            setupComplete={setupComplete}
            onExit={onExit}
          />,
        )
      : render(
          <App
            root={root}
            repository={await LedgerRepository.open(root)}
            setupComplete={setupComplete}
            onExit={onExit}
          />,
        );

  unmount = instance.unmount;
}

try {
  await main();
} catch {
  console.error('無法啟動班費帳本，請確認資料路徑與檔案權限。');
  process.exitCode = 1;
}
