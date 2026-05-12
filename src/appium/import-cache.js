import { upsertVideo } from '../db.js';
import { importFromAndroidDownloadEntries } from '../importers/download-metadata.js';
import {
  connectAndroid,
  dumpAndroidState,
  findBvids,
  parseNodes,
  swipeUp,
  tapNode,
  visibleTextLines
} from './android.js';

const maxScrolls = Number(process.env.MAX_SCROLLS || 20);
const maxShareAttempts = Number(process.env.MAX_SHARE_ATTEMPTS || 8);
const mode = process.env.IMPORT_MODE || 'auto';

const downloadResult = importFromAndroidDownloadEntries();
if (downloadResult.imported > 0 || mode === 'files') {
  console.log(`Imported ${downloadResult.imported} video(s) from Android download metadata.`);
  process.exit(0);
}

const client = await connectAndroid();

try {
  console.log('Connected to Android. 请打开 Bilibili；如果当前在“我的”页，脚本会自动进入离线缓存。');
  await ensureCachePage(client);

  const visibleResult = await importVisibleBvids(client);

  if (visibleResult.empty) {
    console.log('Imported 0 video(s). 请先在这个模拟器里的 Bilibili App 缓存几个视频。');
    process.exitCode = 0;
  } else if (visibleResult.imported > 0 || mode === 'visible') {
    console.log(`Imported ${visibleResult.imported} video(s) from visible UI text.`);
    process.exitCode = 0;
  } else {
    console.log('当前 UI 文本没有直接暴露 BV 号，开始尝试“点开条目 -> 分享 -> 复制链接”的导入流程。');
    const playlistResult = await importOfflinePlaylistByMoreMenu(client);
    const shareResult = playlistResult.imported > 0
      ? playlistResult
      : await importByShareFlow(client);
    console.log(`Imported ${shareResult.imported} video(s) from share links.`);

    if (shareResult.imported === 0) {
      const { xmlPath, screenshotPath } = await dumpAndroidState(client, 'android-import-failed');
      console.log('仍未导入到 BV。已保存诊断文件：');
      console.log(`XML: ${xmlPath}`);
      if (screenshotPath) {
        console.log(`Screenshot: ${screenshotPath}`);
      }
      console.log('把模拟器停在缓存列表页后运行 npm run android:inspect，可以看到可点击控件，方便继续适配。');
    }
  }
} finally {
  await client.deleteSession();
}

async function ensureCachePage(client) {
  let nodes = parseNodes(await client.getPageSource());
  let text = visibleTextLines(nodes).join('\n');

  if (text.includes('离线缓存') && (text.includes('这里还什么都没有') || text.includes('缓存管理') || text.includes('已缓存'))) {
    return;
  }

  const mineTab = nodes.find((node) => {
    const label = `${node.text} ${node.desc}`.trim();
    return node.clickable && label.includes('我的');
  });

  if (mineTab && !text.includes('离线缓存')) {
    console.log('Found 我的 tab; opening it.');
    await tapNode(client, mineTab);
    await client.pause(1800);
    nodes = parseNodes(await client.getPageSource());
    text = visibleTextLines(nodes).join('\n');
  }

  const cacheEntry = nodes.find((node) => {
    const label = `${node.text} ${node.desc}`.trim();
    return node.clickable && label.includes('离线缓存');
  });

  if (cacheEntry) {
    console.log('Found 离线缓存 entry; opening it.');
    await tapNode(client, cacheEntry);
    await client.pause(1800);
  }
}

async function importVisibleBvids(client) {
  const seen = new Map();

  for (let i = 0; i < maxScrolls; i += 1) {
    const xml = await client.getPageSource();
    const nodes = parseNodes(xml);
    if (isEmptyCachePage(nodes)) {
      console.log('离线缓存页是空的：这里还什么都没有呢～');
      return { imported: 0, empty: true };
    }
    if (findOfflinePlaylistItems(nodes).length > 0) {
      console.log('Detected offline playlist items; switching to detail/share import.');
      break;
    }
    collectBvidsFromText(xml, seen);
    collectBvidsFromText(visibleTextLines(nodes).join('\n'), seen);

    console.log(`Visible scan ${i + 1}/${maxScrolls}: collected ${seen.size} BV id(s)`);
    await swipeUp(client);
    await client.pause(700);
  }

  return { imported: upsertSeen(seen, 'android-cache-visible'), empty: false };
}

async function importOfflinePlaylistByMoreMenu(client) {
  const seen = new Map();

  for (let scrollIndex = 0; scrollIndex < maxScrolls && seen.size < maxShareAttempts; scrollIndex += 1) {
    const nodes = parseNodes(await client.getPageSource());
    if (isEmptyCachePage(nodes)) {
      return { imported: 0 };
    }

    const items = findOfflinePlaylistItems(nodes);
    if (!items.length) {
      return { imported: 0 };
    }

    console.log(`Offline playlist scan ${scrollIndex + 1}/${maxScrolls}: ${items.length} visible item(s)`);

    for (const item of items.slice(0, maxShareAttempts - seen.size)) {
      if ([...seen.values()].some((seenItem) => seenItem.title === item.title)) {
        continue;
      }

      const bvid = await openMoreMenuDetailAndCopyBvid(client, item);
      if (bvid) {
        seen.set(bvid, { bvid, title: item.title });
        console.log(`Collected ${bvid} - ${item.title}`);
      } else {
        console.log(`No BV copied for: ${item.title}`);
      }

      await returnToCacheList(client);
      await client.pause(700);
    }

    await swipeUp(client);
    await client.pause(700);
  }

  return { imported: upsertSeen(seen, 'android-cache-share') };
}

async function importByShareFlow(client) {
  const seen = new Map();
  const attemptedKeys = new Set();

  for (let scrollIndex = 0; scrollIndex < maxScrolls && seen.size < maxShareAttempts; scrollIndex += 1) {
    const nodes = parseNodes(await client.getPageSource());
    if (isEmptyCachePage(nodes)) {
      console.log('离线缓存页是空的，请先在这个模拟器里的 Bilibili App 缓存几个视频。');
      break;
    }
    const candidates = findVideoCandidates(nodes).filter((node) => !attemptedKeys.has(candidateKey(node)));

    console.log(`Share scan ${scrollIndex + 1}/${maxScrolls}: ${candidates.length} candidate item(s)`);

    for (const candidate of candidates.slice(0, maxShareAttempts - seen.size)) {
      attemptedKeys.add(candidateKey(candidate));
      const title = candidate.text || candidate.desc || null;
      const bvid = await openCandidateAndCopyBvid(client, candidate);

      if (bvid) {
        seen.set(bvid, { bvid, title });
        console.log(`Collected ${bvid}${title ? ` - ${title}` : ''}`);
      }

      await returnToCacheList(client);
      await client.pause(500);
    }

    await swipeUp(client);
    await client.pause(700);
  }

  return { imported: upsertSeen(seen, 'android-cache-share') };
}

async function openMoreMenuDetailAndCopyBvid(client, item) {
  await tapNode(client, item.more);
  await client.pause(600);

  let nodes = parseNodes(await client.getPageSource());
  const detailNode = findActionNode(nodes, ['查看详情页', '详情页', 'detail']);
  if (!detailNode) {
    await client.back();
    return null;
  }

  await tapNode(client, detailNode);
  await client.pause(2200);

  let xml = await client.getPageSource();
  let bvids = findBvids(xml);
  if (bvids.length) {
    return bvids[0];
  }

  nodes = parseNodes(xml);
  const shareNode = findShareNode(nodes);
  if (!shareNode) {
    return null;
  }

  await tapNode(client, shareNode);
  await client.pause(1000);

  nodes = parseNodes(await client.getPageSource());
  const copyNode = findCopyLinkNode(nodes);
  if (!copyNode) {
    return null;
  }

  await tapNode(client, copyNode);
  await client.pause(900);

  const clipboard = await readClipboard(client);
  return findBvids(clipboard)[0] || null;
}

async function openCandidateAndCopyBvid(client, candidate) {
  await tapNode(client, candidate);
  await client.pause(1600);

  let xml = await client.getPageSource();
  let bvids = findBvids(xml);
  if (bvids.length) {
    return bvids[0];
  }

  const shareNode = findShareNode(parseNodes(xml));
  if (!shareNode) {
    return null;
  }

  await tapNode(client, shareNode);
  await client.pause(1400);

  xml = await client.getPageSource();
  bvids = findBvids(xml);
  if (bvids.length) {
    return bvids[0];
  }

  const copyNode = findCopyLinkNode(parseNodes(xml));
  if (!copyNode) {
    return null;
  }

  await tapNode(client, copyNode);
  await client.pause(700);

  const clipboard = await readClipboard(client);
  return findBvids(clipboard)[0] || null;
}

function collectBvidsFromText(text, seen) {
  for (const bvid of findBvids(text)) {
    seen.set(bvid, { bvid });
  }
}

function upsertSeen(seen, source) {
  let imported = 0;

  for (const item of seen.values()) {
    upsertVideo({
      bvid: item.bvid,
      title: item.title || null,
      url: `https://www.bilibili.com/video/${item.bvid}`,
      source
    });
    imported += 1;
  }

  return imported;
}

function findVideoCandidates(nodes) {
  const ignored = /^(全部|编辑|删除|缓存|缓存设置|已缓存|下载|暂停|继续|清晰度|返回|搜索|管理)$/;

  return nodes
    .filter((node) => node.enabled && node.bounds.width > 180 && node.bounds.height > 32)
    .filter((node) => node.clickable || node.longClickable || /TextView|ViewGroup|FrameLayout|RelativeLayout|LinearLayout/.test(node.className))
    .filter((node) => {
      const label = (node.text || node.desc || '').trim();
      if (!label || ignored.test(label)) {
        return false;
      }
      if (label.includes('这里还什么都没有') || label === 'placeholder') {
        return false;
      }
      if (/^\d+(\.\d+)?[KMG]?B?$/.test(label) || /^\d{1,2}:\d{2}$/.test(label)) {
        return false;
      }
      return label.length >= 4;
    })
    .sort((a, b) => a.bounds.top - b.bounds.top || b.bounds.width - a.bounds.width);
}

function findShareNode(nodes) {
  return findActionNode(nodes, [
    '分享',
    'share'
  ]);
}

function findCopyLinkNode(nodes) {
  return findActionNode(nodes, [
    '复制链接',
    '复制',
    'copy link',
    'copy'
  ]);
}

function findOfflinePlaylistItems(nodes) {
  const titles = nodes
    .filter((node) => node.id.endsWith('/media_title_view') && (node.text || '').trim())
    .sort((a, b) => a.bounds.top - b.bounds.top);
  const moreButtons = nodes
    .filter((node) => node.id.endsWith('/media_more'))
    .sort((a, b) => a.bounds.top - b.bounds.top);

  return titles
    .map((titleNode) => {
      const more = moreButtons.find((button) => Math.abs(button.bounds.cy - titleNode.bounds.cy) < 150);
      if (!more) {
        return null;
      }
      return {
        title: titleNode.text.trim(),
        titleNode,
        more
      };
    })
    .filter(Boolean);
}

function findActionNode(nodes, labels) {
  const lowerLabels = labels.map((label) => label.toLowerCase());
  return nodes.find((node) => {
    const text = `${node.text} ${node.desc} ${node.id}`.toLowerCase();
    return node.enabled && lowerLabels.some((label) => text.includes(label));
  });
}

async function readClipboard(client) {
  const attempts = [
    () => client.getClipboard(),
    () => client.execute('mobile: getClipboard', { contentType: 'plaintext' }),
    () => client.execute('mobile: shell', { command: 'cmd', args: ['clipboard', 'get'] })
  ];

  for (const attempt of attempts) {
    try {
      const value = await attempt();
      if (!value) {
        continue;
      }
      if (typeof value === 'string') {
        return maybeDecodeBase64(value);
      }
      return JSON.stringify(value);
    } catch {
      // Different Appium/Android versions expose clipboard access differently.
    }
  }

  return '';
}

function maybeDecodeBase64(value) {
  if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(value) || value.length % 4 !== 0) {
    return value;
  }

  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return decoded.includes('BV') || decoded.includes('bilibili.com') ? decoded : value;
  } catch {
    return value;
  }
}

async function returnToCacheList(client) {
  for (let i = 0; i < 3; i += 1) {
    const text = visibleTextLines(parseNodes(await client.getPageSource())).join('\n');
    if (text.includes('缓存') || text.includes('离线')) {
      return;
    }
    await client.back();
    await client.pause(700);
  }
}

function candidateKey(node) {
  return `${node.text || node.desc}:${node.bounds.left},${node.bounds.top},${node.bounds.right},${node.bounds.bottom}`;
}

function isEmptyCachePage(nodes) {
  return visibleTextLines(nodes).some((line) => line.includes('这里还什么都没有'));
}
