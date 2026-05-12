import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
export const dataDir = join(rootDir, 'data');
export const dbPath = join(dataDir, 'bili-watch.sqlite');

mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bvid TEXT NOT NULL UNIQUE,
    title TEXT,
    url TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    current_status TEXT NOT NULL DEFAULT 'unknown',
    status_detail TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_checked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    http_status INTEGER,
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
  );
`);

ensureColumn('videos', 'cover_url', 'TEXT');
ensureColumn('videos', 'cache_path', 'TEXT');

export function listVideos() {
  return db.prepare(`
    SELECT
      v.*,
      (
        SELECT COUNT(*)
        FROM checks c
        WHERE c.video_id = v.id
      ) AS check_count
    FROM videos v
    ORDER BY
      CASE v.current_status
        WHEN 'removed' THEN 0
        WHEN 'restricted' THEN 1
        WHEN 'error' THEN 2
        WHEN 'unknown' THEN 3
        ELSE 4
      END,
      COALESCE(v.last_checked_at, v.created_at) DESC
  `).all();
}

export function getVideo(id) {
  return db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
}

export function listBvids() {
  return db.prepare('SELECT bvid FROM videos').all().map((row) => row.bvid);
}

export function upsertVideo({ bvid, title = null, url, source = 'manual', coverUrl = null, cachePath = null }) {
  const cleanBvid = normalizeBvid(bvid);
  const cleanUrl = url || `https://www.bilibili.com/video/${cleanBvid}`;

  db.prepare(`
    INSERT INTO videos (bvid, title, url, source, cover_url, cache_path, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(bvid) DO UPDATE SET
      title = COALESCE(excluded.title, videos.title),
      url = excluded.url,
      source = excluded.source,
      cover_url = COALESCE(excluded.cover_url, videos.cover_url),
      cache_path = COALESCE(excluded.cache_path, videos.cache_path),
      updated_at = CURRENT_TIMESTAMP
  `).run(cleanBvid, title, cleanUrl, source, coverUrl, cachePath);

  return db.prepare('SELECT * FROM videos WHERE bvid = ?').get(cleanBvid);
}

export function updateCheckResult(video, result) {
  const tx = db.createTagStore();
  tx.run`
    INSERT INTO checks (video_id, status, detail, http_status)
    VALUES (${video.id}, ${result.status}, ${result.detail}, ${result.httpStatus ?? null})
  `;
  tx.run`
    UPDATE videos
    SET current_status = ${result.status},
        status_detail = ${result.detail},
        title = COALESCE(${result.title ?? null}, title),
        cover_url = COALESCE(${result.coverUrl ?? null}, cover_url),
        last_checked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${video.id}
  `;
}

export function listChecks(videoId) {
  return db.prepare(`
    SELECT *
    FROM checks
    WHERE video_id = ?
    ORDER BY checked_at DESC
    LIMIT 100
  `).all(videoId);
}

export function normalizeBvid(value) {
  const match = String(value || '').match(/BV[a-zA-Z0-9]{10}/);
  if (!match) {
    throw new Error(`Invalid BV id: ${value}`);
  }
  return match[0];
}

function ensureColumn(table, column, type) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}
