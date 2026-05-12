import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { XMLParser } from 'fast-xml-parser';
import { dataDir } from './db.js';

const exportDir = join(dataDir, 'exports');
const imageNames = ['cover.jpg', 'cover.jpeg', 'cover.png', 'image.jpg', 'image.png'];
const execFileAsync = promisify(execFile);
const mp4Jobs = new Map();
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'text'
});

export function findCacheFile(cachePath, names) {
  if (!cachePath || !existsSync(cachePath)) {
    return null;
  }

  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const stack = [cachePath];

  while (stack.length) {
    const current = stack.pop();
    const stat = statSync(current);

    if (stat.isFile()) {
      if (wanted.has(basename(current).toLowerCase())) {
        return current;
      }
      continue;
    }

    if (!stat.isDirectory()) {
      continue;
    }

    for (const name of readdirSync(current)) {
      stack.push(join(current, name));
    }
  }

  return null;
}

export function createCacheZip(video) {
  if (!video.cache_path || !existsSync(video.cache_path)) {
    return null;
  }

  mkdirSync(exportDir, { recursive: true });
  const zipPath = join(exportDir, `${video.bvid}.zip`);
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Compress-Archive -Path '${escapePowerShell(video.cache_path)}\\*' -DestinationPath '${escapePowerShell(zipPath)}' -Force`
  ], {
    timeout: 5 * 60 * 1000,
    windowsHide: true
  });

  return zipPath;
}

export function findCacheCover(video) {
  return findCacheFile(video.cache_path, imageNames);
}

export function readDanmaku(video) {
  const xmlPath = findCacheFile(video.cache_path, ['danmaku.xml']);
  if (!xmlPath) {
    return [];
  }

  const xml = readFileSync(xmlPath, 'utf8');
  const parsed = xmlParser.parse(xml);
  const items = Array.isArray(parsed?.i?.d) ? parsed.i.d : [parsed?.i?.d].filter(Boolean);

  return items
    .map(toDanmakuComment)
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

export function getMergedMp4Path(video) {
  return join(exportDir, `${video.bvid}-browser.mp4`);
}

export function hasMergedMp4(video) {
  const sources = findMediaSources(video);
  if (!sources) {
    return false;
  }

  return isFresh(getMergedMp4Path(video), [sources.videoFile, sources.audioFile]);
}

export function warmMergedMp4(video) {
  ensureMergedMp4(video).catch((error) => {
    console.error(`[ffmpeg] failed to prepare ${video.bvid}:`, error);
  });
}

export async function ensureMergedMp4(video) {
  if (!video.cache_path || !existsSync(video.cache_path)) {
    return null;
  }

  const sources = findMediaSources(video);
  if (!sources) {
    return null;
  }

  mkdirSync(exportDir, { recursive: true });
  const mp4Path = getMergedMp4Path(video);
  const key = `${video.bvid}:${video.cache_path}`;

  if (mp4Jobs.has(key)) {
    await mp4Jobs.get(key);
    return mp4Path;
  }

  if (isFresh(mp4Path, [sources.videoFile, sources.audioFile])) {
    return mp4Path;
  }

  mp4Jobs.set(key, runFfmpeg(sources.videoFile, sources.audioFile, mp4Path).finally(() => {
    mp4Jobs.delete(key);
  }));

  await mp4Jobs.get(key);
  return mp4Path;
}

function findMediaSources(video) {
  const videoFile = findCacheFile(video.cache_path, ['video.m4s']);
  const audioFile = findCacheFile(video.cache_path, ['audio.m4s']);

  if (!videoFile || !audioFile) {
    return null;
  }

  return { videoFile, audioFile };
}

function toDanmakuComment(item) {
  const parts = String(item.p || '').split(',');
  const time = Number(parts[0]);
  const bilibiliMode = Number(parts[1]);
  const fontSize = Math.min(Math.max(Number(parts[2]) || 25, 18), 32);
  const color = formatColor(parts[3]);
  const text = String(item.text || '').trim();

  if (!Number.isFinite(time) || !text) {
    return null;
  }

  return {
    text,
    mode: convertDanmakuMode(bilibiliMode),
    time,
    style: {
      fontSize: `${fontSize}px`,
      color,
      fontWeight: '600',
      textShadow: '-1px -1px #000, -1px 1px #000, 1px -1px #000, 1px 1px #000'
    }
  };
}

function convertDanmakuMode(mode) {
  if (mode === 4) {
    return 'bottom';
  }

  if (mode === 5) {
    return 'top';
  }

  if (mode === 6) {
    return 'ltr';
  }

  return 'rtl';
}

function formatColor(value) {
  const color = Number(value);
  if (!Number.isFinite(color)) {
    return '#ffffff';
  }

  return `#${color.toString(16).padStart(6, '0').slice(-6)}`;
}

async function runFfmpeg(videoFile, audioFile, mp4Path) {
  await execFileAsync(ffmpeg.path, [
    '-y',
    '-i',
    videoFile,
    '-i',
    audioFile,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    mp4Path
  ], {
    timeout: 10 * 60 * 1000,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024
  });
}

function isFresh(target, sources) {
  if (!existsSync(target)) {
    return false;
  }

  const targetMtime = statSync(target).mtimeMs;
  return sources.every((source) => statSync(source).mtimeMs <= targetMtime);
}

function escapePowerShell(value) {
  return String(value).replaceAll("'", "''");
}
