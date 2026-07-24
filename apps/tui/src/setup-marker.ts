import {randomUUID} from 'node:crypto';
import * as fs from 'node:fs/promises';
import type {FileHandle} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';

export interface SetupMarkerDependencies {
  fileSystem?: typeof fs;
  createTemporarySuffix?: () => string;
}

export function setupMarkerPath(root: string): string {
  return resolve(root, '.local/setup-complete');
}

export async function hasSetupMarker(root: string): Promise<boolean> {
  try {
    return (await fs.stat(setupMarkerPath(root))).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function closeQuietly(handle: FileHandle | null): Promise<void> {
  if (handle === null) return;
  try {
    await handle.close();
  } catch {
    // Preserve the operation's original failure.
  }
}

async function removeQuietly(
  path: string,
  fileSystem: typeof fs,
): Promise<void> {
  try {
    await fileSystem.rm(path, {force: true});
  } catch {
    // Preserve the operation's original failure.
  }
}

async function syncDirectory(
  path: string,
  fileSystem: typeof fs,
): Promise<void> {
  const handle = await fileSystem.open(path, 'r');
  let syncError: unknown;
  let closeError: unknown;

  try {
    await handle.sync();
  } catch (error) {
    syncError = error;
  }

  try {
    await handle.close();
  } catch (error) {
    closeError = error;
  }

  if (syncError !== undefined) throw syncError;
  if (closeError !== undefined) throw closeError;
}

export async function writeSetupMarker(
  root: string,
  dependencies: SetupMarkerDependencies = {},
): Promise<void> {
  const fileSystem = dependencies.fileSystem ?? fs;
  const createTemporarySuffix =
    dependencies.createTemporarySuffix ??
    (() => `${process.pid}-${randomUUID()}`);
  const destination = setupMarkerPath(root);
  const parent = dirname(destination);
  const temporary = join(
    parent,
    `.${basename(destination)}.${createTemporarySuffix()}.tmp`,
  );
  let handle: FileHandle | null = null;
  let ownsTemporary = false;

  const createdDirectory = await fileSystem.mkdir(parent, {recursive: true});
  if (createdDirectory !== undefined) {
    await syncDirectory(dirname(parent), fileSystem);
  }

  try {
    handle = await fileSystem.open(temporary, 'wx');
    ownsTemporary = true;
    await handle.writeFile('complete\n');
    await handle.sync();
    await handle.close();
    handle = null;
    await fileSystem.rename(temporary, destination);
    ownsTemporary = false;
    await syncDirectory(parent, fileSystem);
  } catch (error) {
    await closeQuietly(handle);
    if (ownsTemporary) {
      await removeQuietly(temporary, fileSystem);
    }
    throw error;
  }
}
