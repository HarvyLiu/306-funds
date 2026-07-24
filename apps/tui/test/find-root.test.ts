import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, parse, resolve} from 'node:path';

import {afterEach, describe, expect, it} from 'vitest';

import {
  findLedgerRoot,
  LedgerRootNotFoundError,
} from '../src/find-root.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, {recursive: true})),
  );
});

async function makeTemporaryDirectory(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'class-fund-find-root-'));
  temporaryRoots.push(root);
  return root;
}

async function writeCanonicalFile(
  root: string,
  name: 'settings.json' | 'transactions.csv',
): Promise<void> {
  await fs.mkdir(join(root, 'data'), {recursive: true});
  await fs.writeFile(join(root, 'data', name), 'fixture');
}

describe('findLedgerRoot', () => {
  it('finds the repository from a nested directory when both files exist', async () => {
    const root = await makeTemporaryDirectory();
    const nested = join(root, 'apps', 'tui');
    await fs.mkdir(nested, {recursive: true});
    await Promise.all([
      writeCanonicalFile(root, 'settings.json'),
      writeCanonicalFile(root, 'transactions.csv'),
    ]);

    expect(findLedgerRoot(nested)).toBe(resolve(root));
  });

  it('starts safely from a file path', async () => {
    const root = await makeTemporaryDirectory();
    const nested = join(root, 'apps', 'tui');
    const entry = join(nested, 'main.tsx');
    await fs.mkdir(nested, {recursive: true});
    await Promise.all([
      fs.writeFile(entry, ''),
      writeCanonicalFile(root, 'settings.json'),
      writeCanonicalFile(root, 'transactions.csv'),
    ]);

    expect(findLedgerRoot(entry)).toBe(resolve(root));
  });

  it.each(['directory', 'file'] as const)(
    'traverses physical ancestry from a %s symlink start',
    async (kind) => {
      const root = await makeTemporaryDirectory();
      const aliasRoot = await makeTemporaryDirectory();
      const nested = join(root, 'apps', 'tui');
      const entry = join(nested, 'main.tsx');
      await fs.mkdir(nested, {recursive: true});
      await Promise.all([
        fs.writeFile(entry, ''),
        writeCanonicalFile(root, 'settings.json'),
        writeCanonicalFile(root, 'transactions.csv'),
      ]);
      const alias = join(aliasRoot, kind === 'directory' ? 'tui-link' : 'main-link');
      await fs.symlink(kind === 'directory' ? nested : entry, alias);

      expect(findLedgerRoot(alias)).toBe(await fs.realpath(root));
    },
  );

  it('reports the original requested path for broken and nonexistent starts', async () => {
    const root = await makeTemporaryDirectory();
    const broken = join(root, 'broken-link');
    const nonexistent = join(root, 'never-created');
    await fs.symlink(join(root, 'missing-target'), broken);

    for (const requested of [broken, nonexistent]) {
      expect(() => findLedgerRoot(requested)).toThrow(
        expect.objectContaining({
          name: 'LedgerRootNotFoundError',
          path: resolve(requested),
        }),
      );
    }
  });

  it.each(['settings.json', 'transactions.csv'] as const)(
    'does not accept a directory containing only %s',
    async (name) => {
      const root = await makeTemporaryDirectory();
      await writeCanonicalFile(root, name);

      expect(() => findLedgerRoot(root)).toThrow(LedgerRootNotFoundError);
    },
  );

  it('throws a typed error containing the resolved start path', async () => {
    const root = await makeTemporaryDirectory();
    const nested = join(root, 'missing', 'nested');
    await fs.mkdir(nested, {recursive: true});

    try {
      findLedgerRoot(nested);
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerRootNotFoundError);
      expect(error).toMatchObject({
        name: 'LedgerRootNotFoundError',
        path: resolve(nested),
      });
      return;
    }

    throw new Error('Expected root discovery to fail');
  });

  it('terminates when discovery reaches the filesystem root', () => {
    const fileSystemRoot = parse(resolve('.')).root;

    expect(() => findLedgerRoot(fileSystemRoot)).toThrow(
      LedgerRootNotFoundError,
    );
  });
});
