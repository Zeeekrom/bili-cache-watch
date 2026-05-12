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
  console.log('Connected to Android. Open Bilibili; if the current screen is the profile tab, the script will try to open offline cache automatically.');
  await ensureCachePage(client);

  const visibleResult = await importVisibleBvids(client);

  if (visibleResult.empty) {
    console.log('Imported 0 video(s). Cache a few videos in the Bilibili app on this emulator first.');
    process.exitCode = 0;
  } else if (visibleResult.imported > 0 || mode === 'visible') {
    console.log(`Imported ${visibleResult.imported} video(s) from visible UI text.`);
    process.exitCode = 0;
  } else {
    console.log('The current UI text does not expose BV IDs directly. Trying the item -> share -> copy link import flow.');
    const playlistResult = await importOfflinePlaylistByMoreMenu(client);
    const shareResult = playlistResult.imported > 0
      ? playlistResult
      : await importByShareFlow(client);
    console.log(`Imported ${shareResult.imported} video(s) from share links.`);

    if (shareResult.imported === 0) {
      const { xmlPath, screenshotPath } = await dumpAndroidState(client, 'android-import-failed');
      console.log('No BV ID was imported. Diagnostic files were saved:');
      console.log(`XML: ${xmlPath}`);
      if (screenshotPath) {
        console.log(`Screenshot: ${screenshotPath}`);
      }
      console.log('Keep the emulator on the cache list page and run npm run android:inspect to inspect clickable controls for further adaptation.');
    }
  }
} finally {
  await client.deleteSession();
}

async function ensureCachePage(client) {
  let nodes = parseNodes(await client.getPageSource());
  let text = visibleTextLines(nodes).join('\n');

  if (text.includes('\u79bb\u7ebf\u7f13\u5b58') && (text.includes('\u8fd9\u91cc\u8fd8\u4ec0\u4e48\u90fd\u6ca1\u6709') || text.includes('\u7f13\u5b58\u7ba1\u7406') || text.includes('\u5df2\u7f13\u5b58'))) {
    return;
  }

  const mineTab = nodes.find((node) => {
    const label = `${node.text} ${node.desc}`.trim();
    return node.clickable && label.includes('\u6211\u7684');
  });

  if (mineTab && !text.includes('\u79bb\u7ebf\u7f13\u5b58')) {
    console.log('Found profile tab; opening it.');
    await tapNode(client, mineTab);
    await client.pause(1800);
    nodes = parseNodes(await client.getPageSource());
    text = visibleTextLines(nodes).join('\n');
  }

  const cacheEntry = nodes.find((node) => {
    const label = `${node.text} ${node.desc}`.trim();
    return node.clickable && label.includes('\u79bb\u7ebf\u7f13\u5b58');
  });

  if (cacheEntry) {
    console.log('Found offline cache entry; opening it.');
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
      console.log('The offline cache page is empty.');
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
      console.log('The offline cache page is empty. Cache a few videos in the Bilibili app on this emulator first.');
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
  const detailNode = findActionNode(nodes, ['\u67e5\u770b\u8be6\u60c5\u9875', '\u8be6\u60c5\u9875', 'detail']);
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
  const ignored = new RegExp('^(' + [
    '\u5168\u90e8',
    '\u7f16\u8f91',
    '\u5220\u9664',
    '\u7f13\u5b58',
    '\u7f13\u5b58\u8bbe\u7f6e',
    '\u5df2\u7f13\u5b58',
    '\u4e0b\u8f7d',
    '\u6682\u505c',
    '\u7ee7\u7eed',
    '\u6e05\u6670\u5ea6',
    '\u8fd4\u56de',
    '\u641c\u7d22',
    '\u7ba1\u7406'
  ].join('|') + ')$');

  return nodes
    .filter((node) => node.enabled && node.bounds.width > 180 && node.bounds.height > 32)
    .filter((node) => node.clickable || node.longClickable || /TextView|ViewGroup|FrameLayout|RelativeLayout|LinearLayout/.test(node.className))
    .filter((node) => {
      const label = (node.text || node.desc || '').trim();
      if (!label || ignored.test(label)) {
        return false;
      }
      if (label.includes('\u8fd9\u91cc\u8fd8\u4ec0\u4e48\u90fd\u6ca1\u6709') || label === 'placeholder') {
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
    '\u5206\u4eab',
    'share'
  ]);
}

function findCopyLinkNode(nodes) {
  return findActionNode(nodes, [
    '\u590d\u5236\u94fe\u63a5',
    '\u590d\u5236',
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
    if (text.includes('\u7f13\u5b58') || text.includes('\u79bb\u7ebf')) {
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
  return visibleTextLines(nodes).some((line) => line.includes('\u8fd9\u91cc\u8fd8\u4ec0\u4e48\u90fd\u6ca1\u6709'));
}
