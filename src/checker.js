import { listVideos, updateCheckResult } from './db.js';

const REMOVED_PATTERNS = [
  '\u89c6\u9891\u4e0d\u89c1\u4e86',
  '\u7a3f\u4ef6\u4e0d\u53ef\u89c1',
  '\u89c6\u9891\u5df2\u5931\u6548',
  '\u89c6\u9891\u5df2\u5220\u9664',
  '\u4e0d\u5b58\u5728',
  '404'
];

const RESTRICTED_PATTERNS = [
  '\u6743\u9650\u4e0d\u8db3',
  '\u4ec5\u9650',
  '\u6682\u65f6\u65e0\u6cd5\u89c2\u770b',
  '\u5730\u533a\u9650\u5236',
  '\u5ba1\u6838'
];

const BILI_VIEW_API = 'https://api.bilibili.com/x/web-interface/view';

export async function checkVideo(video) {
  const url = video.url || `https://www.bilibili.com/video/${video.bvid}`;

  try {
    const apiResult = await checkVideoViaApi(video.bvid);
    if (apiResult.status !== 'unknown') {
      return apiResult;
    }

    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    });
    const text = await response.text();
    const pageText = text.slice(0, 300000);
    const titleText = extractTitle(text);

    if (response.ok && (pageText.includes(`"bvid":"${video.bvid}"`) || titleText.includes(video.bvid))) {
      return {
        status: 'available',
        detail: `Page is accessible, HTTP ${response.status}`,
        httpStatus: response.status
      };
    }

    if (response.status === 404 || containsAny(titleText, REMOVED_PATTERNS)) {
      return {
        status: 'removed',
        detail: `Page appears removed or unavailable, HTTP ${response.status}`,
        httpStatus: response.status
      };
    }

    if (response.status === 403 || containsAny(titleText, RESTRICTED_PATTERNS)) {
      return {
        status: 'restricted',
        detail: `Page exists but appears restricted, HTTP ${response.status}`,
        httpStatus: response.status
      };
    }

    if (!response.ok) {
      return {
        status: 'error',
        detail: `Request failed, HTTP ${response.status}`,
        httpStatus: response.status
      };
    }

    if (!pageText.includes(video.bvid)) {
      return {
        status: 'unknown',
        detail: 'Page is accessible, but the BV ID was not confirmed in the page source',
        httpStatus: response.status
      };
    }

    return {
      status: 'available',
      detail: `Page is accessible, HTTP ${response.status}`,
      httpStatus: response.status
    };
  } catch (error) {
    return {
      status: 'error',
      detail: error.message,
      httpStatus: null
    };
  }
}

export async function checkAllVideos() {
  const videos = listVideos();
  const results = [];

  for (const video of videos) {
    const result = await checkVideo(video);
    updateCheckResult(video, result);
    results.push({ video, result });
  }

  return results;
}

async function checkVideoViaApi(bvid) {
  const response = await fetch(`${BILI_VIEW_API}?bvid=${encodeURIComponent(bvid)}`, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      referer: `https://www.bilibili.com/video/${bvid}`,
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  });

  if (!response.ok) {
    return {
      status: 'unknown',
      detail: `API request failed, HTTP ${response.status}`,
      httpStatus: response.status
    };
  }

  const payload = await response.json();

  if (payload.code === 0 && payload.data?.bvid === bvid) {
    return {
      status: 'available',
      detail: `API confirmed available: ${payload.data.title || bvid}`,
      title: payload.data.title || null,
      coverUrl: payload.data.pic || null,
      httpStatus: response.status
    };
  }

  if ([-400, -404, 62002].includes(payload.code)) {
    return {
      status: 'removed',
      detail: `API reports unavailable: ${payload.message || payload.code}`,
      httpStatus: response.status
    };
  }

  if ([62004, 62012].includes(payload.code)) {
    return {
      status: 'restricted',
      detail: `API reports restricted: ${payload.message || payload.code}`,
      httpStatus: response.status
    };
  }

  return {
    status: 'unknown',
    detail: `API returned an unrecognized status: ${payload.message || payload.code}`,
    httpStatus: response.status
  };
}

function containsAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/is);
  return match ? decodeHtml(match[1]) : '';
}

function decodeHtml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#x2F;', '/');
}
