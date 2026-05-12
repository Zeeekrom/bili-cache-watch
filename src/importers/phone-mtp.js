import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, listBvids } from '../db.js';
import { importFromLocalCachePath } from './download-metadata.js';

const rootDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const scriptPath = join(rootDir, 'scripts', 'import-mtp.ps1');
const phoneImportRoot = join(dataDir, 'phone-import');

export function importFromPhoneMtp(sourcePath) {
  if (!sourcePath || typeof sourcePath !== 'string') {
    throw new Error('请填写手机缓存路径');
  }

  mkdirSync(phoneImportRoot, { recursive: true });

  const existingBvidsJson = JSON.stringify(listBvids());
  const raw = execFileSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-SourcePath',
    sourcePath,
    '-DestinationRoot',
    phoneImportRoot,
    '-ExistingBvidsJson',
    existingBvidsJson
  ], {
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024
  });

  let copyResult;
  try {
    copyResult = JSON.parse(raw.trim());
  } catch (error) {
    const debugPath = join(dataDir, 'phone-mtp-last-output.txt');
    writeFileSync(debugPath, raw, 'utf8');
    throw new Error(`手机复制脚本返回内容无法解析，已保存到 ${debugPath}：${error.message}`);
  }
  if (!copyResult.ok) {
    throw new Error(copyResult.error || '手机缓存复制失败');
  }

  const copiedPath = resolveCopiedPath(copyResult.destination);
  const importResult = copyResult.copied > 0
    ? importFromLocalCachePath(copiedPath, 'phone-mtp')
    : { scanned: 0, imported: 0, videos: [], errors: [] };

  return {
    ...importResult,
    sourcePath,
    copiedTo: copiedPath,
    phoneScanned: copyResult.scanned,
    copied: copyResult.copied,
    skippedExisting: copyResult.skippedExisting,
    copyErrors: copyResult.errors || []
  };
}

function resolveCopiedPath(pathFromScript) {
  if (pathFromScript && existsSync(pathFromScript)) {
    return pathFromScript;
  }

  const latest = readdirSync(phoneImportRoot)
    .map((name) => join(phoneImportRoot, name))
    .filter((path) => statSync(path).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

  if (!latest) {
    throw new Error('手机缓存复制完成，但没有找到本地复制目录');
  }

  return latest;
}
