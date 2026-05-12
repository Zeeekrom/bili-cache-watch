import { listVideos, updateCheckResult } from './db.js';

const REMOVED_PATTERNS = [
  '视频不见了',
  '稿件不可见',
  '视频已失效',
  '视频已删除',
  '不存在',
  '404'
];

const RESTRICTED_PATTERNS = [
  '权限不足',
  '仅限',
  '暂时无法观看',
  '地区限制',
  '审核'
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
        detail: `页面可访问，HTTP ${response.status}`,
        httpStatus: response.status
      };
    }

    if (response.status === 404 || containsAny(titleText, REMOVED_PATTERNS)) {
      return {
        status: 'removed',
        detail: `页面显示疑似删除或不可见，HTTP ${response.status}`,
        httpStatus: response.status
      };
    }

    if (response.status === 403 || containsAny(titleText, RESTRICTED_PATTERNS)) {
      return {
        status: 'restricted',
        detail: `页面存在但疑似受限，HTTP ${response.status}`,
        httpStatus: response.status
      };
    }

    if (!response.ok) {
      return {
        status: 'error',
        detail: `请求异常，HTTP ${response.status}`,
        httpStatus: response.status
      };
    }

    if (!pageText.includes(video.bvid)) {
      return {
        status: 'unknown',
        detail: '页面可访问，但未在页面源码中确认 BV 号',
        httpStatus: response.status
      };
    }

    return {
      status: 'available',
      detail: `页面可访问，HTTP ${response.status}`,
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
      detail: `接口请求异常，HTTP ${response.status}`,
      httpStatus: response.status
    };
  }

  const payload = await response.json();

  if (payload.code === 0 && payload.data?.bvid === bvid) {
    return {
      status: 'available',
      detail: `接口确认正常：${payload.data.title || bvid}`,
      title: payload.data.title || null,
      coverUrl: payload.data.pic || null,
      httpStatus: response.status
    };
  }

  if ([-400, -404, 62002].includes(payload.code)) {
    return {
      status: 'removed',
      detail: `接口显示不可见：${payload.message || payload.code}`,
      httpStatus: response.status
    };
  }

  if ([62004, 62012].includes(payload.code)) {
    return {
      status: 'restricted',
      detail: `接口显示受限：${payload.message || payload.code}`,
      httpStatus: response.status
    };
  }

  return {
    status: 'unknown',
    detail: `接口返回未识别状态：${payload.message || payload.code}`,
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
