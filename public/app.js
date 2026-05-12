let currentFilter = 'all';

const videosEl = document.querySelector('#videos');
const addForm = document.querySelector('#addForm');
const checkAllButton = document.querySelector('#checkAll');
const importAndroidButton = document.querySelector('#importAndroid');
const localImportForm = document.querySelector('#localImportForm');
const phoneImportForm = document.querySelector('#phoneImportForm');
const importStatusEl = document.querySelector('#importStatus');
const danmakuPlayers = new Map();

document.querySelectorAll('.toolbar button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.toolbar button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    currentFilter = button.dataset.filter;
    loadVideos();
  });
});

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(addForm);
  const raw = form.get('bvid').trim();
  const bvid = raw.match(/BV[a-zA-Z0-9]{10}/)?.[0];

  if (!bvid) {
    alert('没有识别到 BV 号');
    return;
  }

  await fetch('/api/videos', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bvid,
      title: form.get('title').trim() || null,
      url: `https://www.bilibili.com/video/${bvid}`,
      source: 'manual'
    })
  });

  addForm.reset();
  await loadVideos();
});

checkAllButton.addEventListener('click', async () => {
  checkAllButton.disabled = true;
  checkAllButton.textContent = '检查中';
  await fetch('/api/check-all', { method: 'POST' });
  checkAllButton.disabled = false;
  checkAllButton.textContent = '全部检查';
  await loadVideos();
});

importAndroidButton.addEventListener('click', async () => {
  await runImport(importAndroidButton, '正在读取模拟器缓存', async () => {
    return postJson('/api/import/android', {});
  });
});

localImportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(localImportForm);
  const path = form.get('path').trim();

  if (!path) {
    setImportStatus('请先填写本地缓存目录路径', 'error');
    return;
  }

  const button = localImportForm.querySelector('button');
  await runImport(button, '正在扫描本地路径', async () => {
    return postJson('/api/import/local', { path });
  });
});

phoneImportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(phoneImportForm);
  const path = form.get('path').trim();

  if (!path) {
    setImportStatus('请先填写真实手机缓存路径', 'error');
    return;
  }

  const button = phoneImportForm.querySelector('button');
  await runImport(button, '正在从手机复制未导入缓存', async () => {
    return postJson('/api/import/phone-mtp', { path });
  });
});

async function loadVideos() {
  destroyDanmakuPlayers();
  const response = await fetch('/api/videos');
  const { videos } = await response.json();
  const filtered = currentFilter === 'all'
    ? videos
    : videos.filter((video) => video.current_status === currentFilter);

  videosEl.innerHTML = filtered.length
    ? filtered.map(renderVideo).join('')
    : '<div class="panel">暂无视频</div>';

  videosEl.querySelectorAll('[data-check-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = '检查中';
      await fetch(`/api/videos/${button.dataset.checkId}/check`, { method: 'POST' });
      await loadVideos();
    });
  });

  videosEl.querySelectorAll('[data-preview-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const preview = document.querySelector(`#preview-${button.dataset.previewId}`);
      preview.hidden = !preview.hidden;
      if (!preview.hidden) {
        await setupDanmaku(button.dataset.previewId);
      }
    });
  });

  videosEl.querySelectorAll('[data-danmaku-control]').forEach((control) => {
    control.addEventListener('input', () => updateDanmaku(control.dataset.videoId));
    control.addEventListener('change', () => updateDanmaku(control.dataset.videoId));
  });

  videosEl.querySelectorAll('[data-danmaku-fullscreen]').forEach((button) => {
    button.addEventListener('click', async () => {
      const videoId = button.dataset.videoId;
      const player = document.querySelector(`#player-${videoId}`);
      await player?.requestFullscreen?.();
      resizeDanmaku(videoId);
      window.setTimeout(() => resizeDanmaku(videoId), 100);
    });
  });
}

function renderVideo(video) {
  const status = statusLabel(video.current_status);
  const title = escapeHtml(video.title || video.bvid);
  const detail = escapeHtml(video.status_detail || '尚未检查');
  const lastChecked = video.last_checked_at ? escapeHtml(video.last_checked_at) : '未检查';
  const cover = video.cache_path
    ? `/api/videos/${video.id}/cover`
    : (video.cover_url ? escapeHtml(video.cover_url.replace(/^http:\/\//, 'https://')) : '');
  const coverMarkup = cover
    ? `<img class="cover" src="${cover}" alt="" loading="lazy">`
    : '<div class="cover cover-empty" aria-hidden="true"></div>';
  const abnormal = !['available', 'unknown'].includes(video.current_status);
  const cacheActions = abnormal && video.cache_path
    ? `
      <button data-preview-id="${video.id}">在线预览</button>
      <a class="button-link" href="/api/videos/${video.id}/download">下载 MP4</a>
    `
    : '';
  const preview = abnormal && video.cache_path
    ? `
      <div id="preview-${video.id}" class="preview" hidden>
        <div id="player-${video.id}" class="preview-player">
          <video controls preload="metadata" src="/api/videos/${video.id}/preview"></video>
        </div>
        <div class="danmaku-controls">
          <label>大小 <input type="range" min="16" max="36" value="25" data-danmaku-control data-video-id="${video.id}" data-control="size"></label>
          <label>速度 <input type="range" min="80" max="260" value="160" data-danmaku-control data-video-id="${video.id}" data-control="speed"></label>
          <label>透明度 <input type="range" min="30" max="100" value="100" data-danmaku-control data-video-id="${video.id}" data-control="opacity"></label>
          <button type="button" data-danmaku-fullscreen data-video-id="${video.id}">弹幕全屏</button>
        </div>
        <div id="danmaku-status-${video.id}" class="danmaku-status">弹幕加载中</div>
      </div>
    `
    : '';

  return `
    <article class="video">
      ${coverMarkup}
      <div class="video-main">
        <div>
          <div class="title">${title}</div>
          <div class="meta">
            <a href="${video.url}" target="_blank" rel="noreferrer">${video.bvid}</a>
            <span>${detail}</span>
            <span>最后检查：${lastChecked}</span>
            <span>来源：${escapeHtml(video.source)}</span>
          </div>
        </div>
        ${preview}
      </div>
      <div class="actions">
        <span class="status ${video.current_status}">${status}</span>
        <button data-check-id="${video.id}">检查</button>
        ${cacheActions}
      </div>
    </article>
  `;
}

function destroyDanmakuPlayers() {
  for (const player of danmakuPlayers.values()) {
    player.instance.destroy();
  }
  danmakuPlayers.clear();
}

async function setupDanmaku(videoId) {
  if (danmakuPlayers.has(videoId) || !window.Danmaku) {
    return;
  }

  const container = document.querySelector(`#player-${videoId}`);
  const media = container?.querySelector('video');
  if (!container || !media) {
    return;
  }

  const response = await fetch(`/api/videos/${videoId}/danmaku`);
  const data = await response.json().catch(() => ({ comments: [] }));
  if (!data.comments?.length) {
    setDanmakuStatus(videoId, '未找到本地弹幕');
    return;
  }

  await waitForVideoReady(media);

  const settings = readDanmakuSettings(videoId);
  const danmaku = new window.Danmaku({
    container,
    media,
    comments: buildDanmakuComments(data.comments || [], settings),
    engine: 'DOM',
    speed: settings.speed
  });

  danmaku.resize();
  danmakuPlayers.set(videoId, {
    instance: danmaku,
    comments: data.comments || [],
    media,
    container
  });
  setDanmakuStatus(videoId, `已加载 ${data.comments.length} 条本地弹幕`);
}

function updateDanmaku(videoId) {
  const player = danmakuPlayers.get(videoId);
  if (!player) {
    return;
  }

  const settings = readDanmakuSettings(videoId);
  const currentTime = player.media.currentTime;
  const wasPaused = player.media.paused;

  player.instance.destroy();
  player.instance = new window.Danmaku({
    container: player.container,
    media: player.media,
    comments: buildDanmakuComments(player.comments, settings),
    engine: 'DOM',
    speed: settings.speed
  });
  player.instance.resize();
  player.media.currentTime = currentTime;

  if (!wasPaused) {
    player.instance.show();
  }
}

function resizeDanmaku(videoId) {
  const player = danmakuPlayers.get(videoId);
  if (player) {
    player.instance.resize();
  }
}

function readDanmakuSettings(videoId) {
  const controls = document.querySelectorAll(`[data-video-id="${videoId}"][data-danmaku-control]`);
  const settings = {
    size: 25,
    speed: 160,
    opacity: 1
  };

  for (const control of controls) {
    if (control.dataset.control === 'size') {
      settings.size = Number(control.value) || settings.size;
    }
    if (control.dataset.control === 'speed') {
      settings.speed = Number(control.value) || settings.speed;
    }
    if (control.dataset.control === 'opacity') {
      settings.opacity = (Number(control.value) || 100) / 100;
    }
  }

  return settings;
}

function buildDanmakuComments(comments, settings) {
  return comments.map((comment) => ({
    ...comment,
    style: {
      ...comment.style,
      fontSize: `${settings.size}px`,
      opacity: String(settings.opacity)
    }
  }));
}

function waitForVideoReady(media) {
  if (media.readyState >= 1) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    media.addEventListener('loadedmetadata', resolve, { once: true });
    media.load();
  });
}

function setDanmakuStatus(videoId, text) {
  const status = document.querySelector(`#danmaku-status-${videoId}`);
  if (status) {
    status.textContent = text;
  }
}

async function runImport(button, loadingText, action) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = loadingText;
  setImportStatus(loadingText, 'busy');

  try {
    const result = await action();
    if (result.error) {
      setImportStatus(result.error, 'error');
    } else {
      const names = result.videos
        .slice(0, 5)
        .map((video) => video.title || video.bvid)
        .join('；');
      const suffix = names ? `：${names}` : '';
      const phoneExtra = Number.isFinite(result.copied)
        ? `，复制 ${result.copied} 个，跳过已导入 ${result.skippedExisting || 0} 个`
        : '';
      setImportStatus(`扫描 ${result.phoneScanned || result.scanned} 个缓存文件${phoneExtra}，导入/更新 ${result.imported} 个视频${suffix}`, 'ok');
      await loadVideos();
    }
  } catch (error) {
    setImportStatus(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: data.error || `请求失败：HTTP ${response.status}` };
  }
  return data;
}

function setImportStatus(message, state = '') {
  importStatusEl.textContent = message;
  importStatusEl.className = `import-status ${state}`.trim();
}

function statusLabel(status) {
  return {
    available: '正常',
    removed: '疑似删除',
    restricted: '受限',
    error: '异常',
    unknown: '未知'
  }[status] || status;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

loadVideos();
