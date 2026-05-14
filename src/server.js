import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import { checkAllVideos, checkVideo } from './checker.js';
import { getVideo, listChecks, listVideos, upsertVideo, updateCheckResult } from './db.js';
import { ensureMergedMp4, findCacheCover, readDanmaku, warmMergedMp4 } from './cache-files.js';
import { importFromAndroidDownloadEntries, importFromLocalCachePath } from './importers/download-metadata.js';
import { importFromPhoneMtp } from './importers/phone-mtp.js';
import { handleLogin, handleLogout, loginPage, requireAuth, warnIfAuthDefaults } from './auth.js';
import { normaliseLanguage, translateVideoTitles } from './translation.js';
import { APP_VERSION, APP_VERSION_LABEL } from './version.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const intervalMinutes = Number(process.env.CHECK_INTERVAL_MINUTES || 60);

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.get('/login', loginPage);
app.post('/login', handleLogin);
app.post('/logout', handleLogout);
app.get('/api/version', (_req, res) => {
  res.json({
    name: 'Bili Cache Watch',
    version: APP_VERSION,
    label: APP_VERSION_LABEL
  });
});
app.use(requireAuth);
app.use(express.static('public', {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));
app.use('/vendor/danmaku', express.static('node_modules/danmaku/dist'));

app.get('/api/videos', async (req, res) => {
  const language = normaliseLanguage(req.query.lang);
  const videos = await translateVideoTitles(listVideos(), language);
  res.json({ language, videos });
});

app.post('/api/videos', (req, res) => {
  try {
    const { bvid, title, url, source = 'manual' } = req.body;
    const video = upsertVideo({ bvid, title, url, source });
    res.status(201).json({ video });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/videos/:id/checks', (req, res) => {
  const video = getVideo(Number(req.params.id));
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  res.json({ video, checks: listChecks(video.id) });
});

app.post('/api/videos/:id/check', async (req, res) => {
  const video = getVideo(Number(req.params.id));
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  const result = await checkVideo(video);
  updateCheckResult(video, result);
  const updatedVideo = getVideo(video.id);
  queueMp4ForAbnormal(updatedVideo);
  res.json({ video: updatedVideo, result });
});

app.post('/api/check-all', async (_req, res) => {
  const results = await checkAllVideos();
  for (const item of results) {
    queueMp4ForAbnormal(getVideo(item.video.id));
  }
  res.json({ count: results.length, results });
});

app.get('/api/videos/:id/preview', async (req, res) => {
  const video = getVideo(Number(req.params.id));
  if (!video) {
    res.status(404).send('Video not found');
    return;
  }

  try {
    const file = await ensureMergedMp4(video);
    if (!file) {
      res.status(404).send('Cached video/audio files not found');
      return;
    }

    res.type('video/mp4');
    res.sendFile(file);
  } catch (error) {
    console.error(error);
    res.status(500).send('Failed to create MP4 preview');
  }
});

app.get('/api/videos/:id/cover', (req, res) => {
  const video = getVideo(Number(req.params.id));
  if (!video) {
    res.status(404).send('Video not found');
    return;
  }

  const cover = findCacheCover(video);
  if (cover) {
    res.sendFile(cover, {
      headers: {
        'Cache-Control': 'public, max-age=86400'
      }
    });
    return;
  }

  if (video.cover_url) {
    res.redirect(video.cover_url.replace(/^http:\/\//, 'https://'));
    return;
  }

  res.status(404).send('Cover not found');
});

app.get('/api/videos/:id/danmaku', (req, res) => {
  const video = getVideo(Number(req.params.id));
  if (!video) {
    res.status(404).json({ error: 'Video not found' });
    return;
  }

  try {
    const comments = readDanmaku(video);
    res.json({ comments, count: comments.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to read danmaku' });
  }
});

app.get('/api/videos/:id/download', async (req, res) => {
  const video = getVideo(Number(req.params.id));
  if (!video) {
    res.status(404).send('Video not found');
    return;
  }

  try {
    const mp4Path = await ensureMergedMp4(video);
    if (!mp4Path) {
      res.status(404).send('Cached video/audio files not found');
      return;
    }

    res.download(mp4Path, `${video.bvid}.mp4`);
  } catch (error) {
    console.error(error);
    res.status(500).send('Failed to create MP4 download');
  }
});

app.post('/api/import/android', (_req, res) => {
  try {
    const result = importFromAndroidDownloadEntries();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/import/local', (req, res) => {
  try {
    const result = importFromLocalCachePath(req.body.path);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/import/phone-mtp', (req, res) => {
  try {
    const result = importFromPhoneMtp(req.body.path);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

cron.schedule(`*/${intervalMinutes} * * * *`, async () => {
  console.log(`[cron] checking videos every ${intervalMinutes} minute(s)`);
  const results = await checkAllVideos();
  for (const item of results) {
    queueMp4ForAbnormal(getVideo(item.video.id));
  }
});

app.listen(port, () => {
  warnIfAuthDefaults();
  console.log(`Bili cache watch ${APP_VERSION_LABEL} is running at http://localhost:${port}`);
  console.log(`Check interval: ${intervalMinutes} minute(s)`);
});

function queueMp4ForAbnormal(video) {
  if (!video?.cache_path || ['available', 'unknown'].includes(video.current_status)) {
    return;
  }

  warmMergedMp4(video);
}
