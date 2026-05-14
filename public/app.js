let currentFilter = 'all';
let currentLanguage = localStorage.getItem('bili-cache-language') || 'zh-Hans';

const videosEl = document.querySelector('#videos');
const addForm = document.querySelector('#addForm');
const checkAllButton = document.querySelector('#checkAll');
const languageToggleButton = document.querySelector('#languageToggle');
const appVersionEl = document.querySelector('#appVersion');
const importAndroidButton = document.querySelector('#importAndroid');
const localImportForm = document.querySelector('#localImportForm');
const phoneImportForm = document.querySelector('#phoneImportForm');
const importStatusEl = document.querySelector('#importStatus');
const danmakuPlayers = new Map();

const translations = {
  'zh-Hans': {
    htmlLang: 'zh-Hans',
    nextLanguage: '繁體中文',
    subtitle: '导入哔哩哔哩缓存 BV 号，检查视频状态，并预览本地缓存的异常视频。',
    checkAll: '全部检查',
    checking: '检查中',
    logout: '退出登录',
    bvidPlaceholder: 'BV 号或视频网址',
    titlePlaceholder: '标题，可选',
    add: '添加',
    cacheImport: '缓存导入',
    cacheImportText: '从安卓模拟器或本地缓存文件夹读取哔哩哔哩 entry.json 文件。',
    importAndroid: '从安卓模拟器导入',
    localPathPlaceholder: '本地缓存文件夹，例如 D:\\BiliCache\\download 或导出的 tv.danmaku.bili\\download 文件夹',
    importLocal: '导入本地文件夹',
    importPhone: '从手机复制并导入',
    phoneHint: '从真机导入前，请连接 USB 数据线，在手机上允许文件访问，并确认上方路径指向哔哩哔哩下载缓存文件夹。',
    waitingImport: '等待导入',
    all: '全部',
    removed: '可能已失效',
    available: '可访问',
    noBvid: '没有检测到 BV 号。',
    enterLocalPath: '请先输入本地缓存文件夹路径。',
    enterPhonePath: '请先输入手机缓存路径。',
    readingEmulator: '正在读取模拟器缓存',
    scanningLocal: '正在扫描本地文件夹',
    copyingPhone: '正在复制新的手机缓存项目',
    noVideos: '还没有视频。',
    notCheckedYet: '尚未检查',
    notChecked: '未检查',
    lastChecked: '上次检查',
    source: '来源',
    translationPending: '英文翻译服务未配置，暂时显示原标题',
    preview: '预览',
    downloadMp4: '下载 MP4',
    size: '大小',
    speed: '速度',
    opacity: '透明度',
    danmakuFullscreen: '弹幕全屏',
    check: '检查',
    loadingDanmaku: '正在加载弹幕',
    noDanmaku: '未找到本地弹幕',
    loadedDanmaku: (count) => `已加载 ${count} 条本地弹幕`,
    scanned: (result, suffix) => {
      const phoneExtra = Number.isFinite(result.copied)
        ? `，已复制 ${result.copied} 个，跳过 ${result.skippedExisting || 0} 个已存在项目`
        : '';
      return `已扫描 ${result.phoneScanned || result.scanned} 个缓存文件${phoneExtra}，已导入或更新 ${result.imported} 个视频${suffix}`;
    },
    requestFailed: (status) => `请求失败：HTTP ${status}`,
    status: {
      available: '可访问',
      removed: '可能已失效',
      restricted: '受限',
      error: '错误',
      unknown: '未知'
    }
  },
  'zh-Hant': {
    htmlLang: 'zh-Hant',
    nextLanguage: 'English (AU)',
    subtitle: '匯入嗶哩嗶哩快取 BV 號，檢查影片狀態，並預覽本機快取的異常影片。',
    checkAll: '全部檢查',
    checking: '檢查中',
    logout: '登出',
    bvidPlaceholder: 'BV 號或影片網址',
    titlePlaceholder: '標題，可選',
    add: '新增',
    cacheImport: '快取匯入',
    cacheImportText: '從 Android 模擬器或本機快取資料夾讀取嗶哩嗶哩 entry.json 檔案。',
    importAndroid: '從 Android 模擬器匯入',
    localPathPlaceholder: '本機快取資料夾，例如 D:\\BiliCache\\download 或匯出的 tv.danmaku.bili\\download 資料夾',
    importLocal: '匯入本機資料夾',
    importPhone: '從手機複製並匯入',
    phoneHint: '從真機匯入前，請連接 USB 傳輸線，在手機上允許檔案存取，並確認上方路徑指向嗶哩嗶哩下載快取資料夾。',
    waitingImport: '等待匯入',
    all: '全部',
    removed: '可能已失效',
    available: '可存取',
    noBvid: '沒有偵測到 BV 號。',
    enterLocalPath: '請先輸入本機快取資料夾路徑。',
    enterPhonePath: '請先輸入手機快取路徑。',
    readingEmulator: '正在讀取模擬器快取',
    scanningLocal: '正在掃描本機資料夾',
    copyingPhone: '正在複製新的手機快取項目',
    noVideos: '尚無影片。',
    notCheckedYet: '尚未檢查',
    notChecked: '未檢查',
    lastChecked: '上次檢查',
    source: '來源',
    translationPending: '英文翻譯服務未設定，暫時顯示原標題',
    preview: '預覽',
    downloadMp4: '下載 MP4',
    size: '大小',
    speed: '速度',
    opacity: '透明度',
    danmakuFullscreen: '彈幕全螢幕',
    check: '檢查',
    loadingDanmaku: '正在載入彈幕',
    noDanmaku: '未找到本機彈幕',
    loadedDanmaku: (count) => `已載入 ${count} 則本機彈幕`,
    scanned: (result, suffix) => {
      const phoneExtra = Number.isFinite(result.copied)
        ? `，已複製 ${result.copied} 個，略過 ${result.skippedExisting || 0} 個已存在項目`
        : '';
      return `已掃描 ${result.phoneScanned || result.scanned} 個快取檔案${phoneExtra}，已匯入或更新 ${result.imported} 個影片${suffix}`;
    },
    requestFailed: (status) => `請求失敗：HTTP ${status}`,
    status: {
      available: '可存取',
      removed: '可能已失效',
      restricted: '受限',
      error: '錯誤',
      unknown: '未知'
    }
  },
  'en-AU': {
    htmlLang: 'en-AU',
    nextLanguage: '简体中文',
    subtitle: 'Import cached Bilibili BV IDs, check video status, and preview abnormal local cache videos.',
    checkAll: 'Check All',
    checking: 'Checking',
    logout: 'Log Out',
    bvidPlaceholder: 'BV ID or video URL',
    titlePlaceholder: 'Title, optional',
    add: 'Add',
    cacheImport: 'Cache Import',
    cacheImportText: 'Read Bilibili entry.json files from an Android emulator or a local cache folder.',
    importAndroid: 'Import From Android Emulator',
    localPathPlaceholder: 'Local cache folder, for example D:\\BiliCache\\download or an exported tv.danmaku.bili\\download folder',
    importLocal: 'Import Local Folder',
    importPhone: 'Copy and Import From Phone',
    phoneHint: 'Before importing from a real phone, connect the USB cable, allow file access on the phone, and make sure the path above points to the Bilibili download cache folder.',
    waitingImport: 'Waiting for import',
    all: 'All',
    removed: 'Possibly Removed',
    available: 'Available',
    noBvid: 'No BV ID was detected.',
    enterLocalPath: 'Enter a local cache folder path first.',
    enterPhonePath: 'Enter the phone cache path first.',
    readingEmulator: 'Reading emulator cache',
    scanningLocal: 'Scanning local folder',
    copyingPhone: 'Copying new phone cache items',
    noVideos: 'No videos yet.',
    notCheckedYet: 'Not checked yet',
    notChecked: 'Not checked',
    lastChecked: 'Last checked',
    source: 'Source',
    translationPending: 'English translation service is not configured; showing the original title for now',
    preview: 'Preview',
    downloadMp4: 'Download MP4',
    size: 'Size',
    speed: 'Speed',
    opacity: 'Opacity',
    danmakuFullscreen: 'Danmaku Fullscreen',
    check: 'Check',
    loadingDanmaku: 'Loading danmaku',
    noDanmaku: 'No local danmaku found',
    loadedDanmaku: (count) => `Loaded ${count} local danmaku comments`,
    scanned: (result, suffix) => {
      const phoneExtra = Number.isFinite(result.copied)
        ? `, copied ${result.copied}, skipped ${result.skippedExisting || 0} existing`
        : '';
      return `Scanned ${result.phoneScanned || result.scanned} cache files${phoneExtra}, imported or updated ${result.imported} videos${suffix}`;
    },
    requestFailed: (status) => `Request failed: HTTP ${status}`,
    status: {
      available: 'Available',
      removed: 'Possibly Removed',
      restricted: 'Restricted',
      error: 'Error',
      unknown: 'Unknown'
    }
  }
};

function t(key) {
  return translations[currentLanguage][key] ?? translations['zh-Hans'][key] ?? key;
}

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
    alert(t('noBvid'));
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
  checkAllButton.textContent = t('checking');
  await fetch('/api/check-all', { method: 'POST' });
  checkAllButton.disabled = false;
  checkAllButton.textContent = t('checkAll');
  await loadVideos();
});

importAndroidButton.addEventListener('click', async () => {
  await runImport(importAndroidButton, t('readingEmulator'), async () => {
    return postJson('/api/import/android', {});
  });
});

localImportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(localImportForm);
  const path = form.get('path').trim();

  if (!path) {
    setImportStatus(t('enterLocalPath'), 'error');
    return;
  }

  const button = localImportForm.querySelector('button');
  await runImport(button, t('scanningLocal'), async () => {
    return postJson('/api/import/local', { path });
  });
});

phoneImportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(phoneImportForm);
  const path = form.get('path').trim();

  if (!path) {
    setImportStatus(t('enterPhonePath'), 'error');
    return;
  }

  const button = phoneImportForm.querySelector('button');
  await runImport(button, t('copyingPhone'), async () => {
    return postJson('/api/import/phone-mtp', { path });
  });
});

languageToggleButton.addEventListener('click', () => {
  currentLanguage = {
    'zh-Hans': 'zh-Hant',
    'zh-Hant': 'en-AU',
    'en-AU': 'zh-Hans'
  }[currentLanguage] || 'zh-Hans';
  localStorage.setItem('bili-cache-language', currentLanguage);
  applyLanguage();
  loadVideos();
});

async function loadVideos() {
  destroyDanmakuPlayers();
  const response = await fetch(`/api/videos?lang=${encodeURIComponent(currentLanguage)}`);
  const { videos } = await response.json();
  const filtered = currentFilter === 'all'
    ? videos
    : videos.filter((video) => video.current_status === currentFilter);

  videosEl.innerHTML = filtered.length
    ? filtered.map(renderVideo).join('')
    : `<div class="panel">${t('noVideos')}</div>`;

  videosEl.querySelectorAll('[data-check-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = t('checking');
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

async function loadVersion() {
  try {
    const response = await fetch('/api/version', { cache: 'no-store' });
    const version = await response.json();
    if (appVersionEl && version.label) {
      appVersionEl.textContent = version.label;
      document.title = `Bili Cache Watch ${version.label}`;
    }
  } catch {
    if (appVersionEl) {
      appVersionEl.textContent = 'v?';
    }
  }
}

function renderVideo(video) {
  const status = statusLabel(video.current_status);
  const title = escapeHtml(video.display_title || video.title || video.bvid);
  const detail = escapeHtml(video.status_detail || t('notCheckedYet'));
  const lastChecked = video.last_checked_at ? escapeHtml(video.last_checked_at) : t('notChecked');
  const cover = video.cache_path
    ? `/api/videos/${video.id}/cover`
    : (video.cover_url ? escapeHtml(video.cover_url.replace(/^http:\/\//, 'https://')) : '');
  const coverMarkup = cover
    ? `<img class="cover" src="${cover}" alt="" loading="lazy">`
    : '<div class="cover cover-empty" aria-hidden="true"></div>';
  const abnormal = !['available', 'unknown'].includes(video.current_status);
  const cacheActions = abnormal && video.cache_path
    ? `
      <button data-preview-id="${video.id}">${t('preview')}</button>
      <a class="button-link" href="/api/videos/${video.id}/download">${t('downloadMp4')}</a>
    `
    : '';
  const preview = abnormal && video.cache_path
    ? `
      <div id="preview-${video.id}" class="preview" hidden>
        <div id="player-${video.id}" class="preview-player">
          <video controls preload="metadata" src="/api/videos/${video.id}/preview"></video>
        </div>
        <div class="danmaku-controls">
          <label>${t('size')} <input type="range" min="16" max="36" value="25" data-danmaku-control data-video-id="${video.id}" data-control="size"></label>
          <label>${t('speed')} <input type="range" min="80" max="260" value="160" data-danmaku-control data-video-id="${video.id}" data-control="speed"></label>
          <label>${t('opacity')} <input type="range" min="30" max="100" value="100" data-danmaku-control data-video-id="${video.id}" data-control="opacity"></label>
          <button type="button" data-danmaku-fullscreen data-video-id="${video.id}">${t('danmakuFullscreen')}</button>
        </div>
        <div id="danmaku-status-${video.id}" class="danmaku-status">${t('loadingDanmaku')}</div>
      </div>
    `
    : '';

  return `
    <article class="video">
      ${coverMarkup}
      <div class="video-main">
        <div>
          <div class="title">${title}</div>
          ${video.display_title_pending_translation ? `<div class="translation-note">${t('translationPending')}</div>` : ''}
          <div class="meta">
            <a href="${video.url}" target="_blank" rel="noreferrer">${video.bvid}</a>
            <span>${detail}</span>
            <span>${t('lastChecked')}: ${lastChecked}</span>
            <span>${t('source')}: ${escapeHtml(video.source)}</span>
          </div>
        </div>
        ${preview}
      </div>
      <div class="actions">
        <span class="status ${video.current_status}">${status}</span>
        <button data-check-id="${video.id}">${t('check')}</button>
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
    setDanmakuStatus(videoId, t('noDanmaku'));
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
  setDanmakuStatus(videoId, t('loadedDanmaku')(data.comments.length));
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
        .map((video) => video.display_title || video.title || video.bvid)
        .join('; ');
      const suffix = names ? `: ${names}` : '';
      setImportStatus(t('scanned')(result, suffix), 'ok');
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
    return { error: data.error || t('requestFailed')(response.status) };
  }
  return data;
}

function setImportStatus(message, state = '') {
  importStatusEl.textContent = message;
  importStatusEl.className = `import-status ${state}`.trim();
}

function statusLabel(status) {
  return t('status')[status] || status;
}

function applyLanguage() {
  const dictionary = translations[currentLanguage] || translations['zh-Hans'];
  document.documentElement.lang = dictionary.htmlLang;
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  languageToggleButton.textContent = dictionary.nextLanguage;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

applyLanguage();
loadVersion();
loadVideos();
