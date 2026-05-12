import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { upsertVideo } from '../db.js';

const ANDROID_DOWNLOAD_ROOT = '/sdcard/Android/data/tv.danmaku.bili/download';

export function importFromAndroidDownloadEntries() {
  const paths = findAndroidDownloadEntryPaths();
  const entries = [];
  const errors = [];

  for (const path of paths) {
    try {
      entries.push(parseEntryJson(execFileSync('adb', ['shell', 'cat', path], {
        encoding: 'utf8',
        timeout: 10000
      }), path));
    } catch (error) {
      errors.push({ path, error: error.message });
    }
  }

  return upsertEntries(entries, 'android-download', errors);
}

export function importFromLocalCachePath(inputPath, source = 'local-cache') {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('请填写本地缓存目录路径');
  }

  const root = resolve(inputPath);
  if (!existsSync(root)) {
    throw new Error(`路径不存在：${root}`);
  }

  const paths = findLocalEntryPaths(root);
  const entries = [];
  const errors = [];

  for (const path of paths) {
    try {
      entries.push(parseEntryJson(readFileSync(path, 'utf8'), path));
    } catch (error) {
      errors.push({ path, error: error.message });
    }
  }

  return upsertEntries(entries, source, errors);
}

function findAndroidDownloadEntryPaths() {
  try {
    const output = execFileSync('adb', [
      'shell',
      'find',
      ANDROID_DOWNLOAD_ROOT,
      '-name',
      'entry.json',
      '-type',
      'f'
    ], { encoding: 'utf8', timeout: 30000 });

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function findLocalEntryPaths(root) {
  const results = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    const stat = statSync(current);

    if (stat.isFile()) {
      if (current.toLowerCase().endsWith('entry.json')) {
        results.push(current);
      }
      continue;
    }

    if (!stat.isDirectory()) {
      continue;
    }

    for (const name of readdirSync(current)) {
      stack.push(resolve(current, name));
    }
  }

  return results;
}

function parseEntryJson(raw, path) {
  const entry = JSON.parse(raw);
  const bvid = entry.bvid || avidToBvid(entry.avid);
  if (!bvid) {
    throw new Error('entry.json 中没有 bvid 或 avid');
  }

  return {
    bvid,
    title: entry.title || entry.page_data?.part || null,
    ownerName: entry.owner_name || null,
    coverUrl: entry.cover || null,
    cachePath: path.startsWith('/sdcard/') ? null : dirname(path),
    path
  };
}

function avidToBvid(avid) {
  if (!Number.isFinite(Number(avid)) || Number(avid) <= 0) {
    return null;
  }

  const table = 'fZodR9XQDSUm21yCkr6zBqiveYah8bt4xsWpHnJE7jL5VG3guMTKNPAwcF';
  const positions = [11, 10, 3, 8, 4, 6];
  const xor = 177451812;
  const add = 8728348608;
  let value = (Number(avid) ^ xor) + add;
  const chars = 'BV1  4 1 7  '.split('');

  for (let i = 0; i < positions.length; i += 1) {
    chars[positions[i]] = table[Math.floor(value / 58 ** i) % 58];
  }

  return chars.join('');
}

function upsertEntries(entries, source, errors = []) {
  const seen = new Map();

  for (const entry of entries) {
    seen.set(entry.bvid, entry);
  }

  const videos = [];
  for (const item of seen.values()) {
    const title = item.ownerName && item.title
      ? `${item.title} - ${item.ownerName}`
      : item.title;
    videos.push(upsertVideo({
      bvid: item.bvid,
      title,
      url: `https://www.bilibili.com/video/${item.bvid}`,
      source,
      coverUrl: item.coverUrl || null,
      cachePath: item.cachePath || null
    }));
  }

  return {
    scanned: entries.length + errors.length,
    imported: videos.length,
    videos,
    errors
  };
}
