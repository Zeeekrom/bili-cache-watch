import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { remote } from 'webdriverio';
import { dataDir } from '../db.js';

export const appiumUrl = new URL(process.env.APPIUM_URL || 'http://127.0.0.1:4723/wd/hub');

export async function connectAndroid() {
  await assertAppiumServer();
  assertAndroidDevice();

  try {
    return await remote({
      protocol: appiumUrl.protocol.replace(':', ''),
      hostname: appiumUrl.hostname,
      port: Number(appiumUrl.port || 4723),
      path: appiumUrl.pathname,
      logLevel: process.env.WDIO_LOG_LEVEL || 'error',
      connectionRetryCount: 1,
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:deviceName': process.env.ANDROID_DEVICE_NAME || 'Android Emulator',
        'appium:noReset': true,
        'appium:autoGrantPermissions': false,
        'appium:newCommandTimeout': 300
      }
    });
  } catch (error) {
    throw new Error(toFriendlyConnectError(error));
  }
}

export async function assertAppiumServer() {
  const statusUrl = `${appiumUrl.origin}${appiumUrl.pathname.replace(/\/$/, '')}/status`;
  try {
    const response = await fetch(statusUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch {
    throw new Error([
      'Cannot connect to the Appium server.',
      'Run: npm run appium:start',
      'Keep that terminal open, then run android:inspect or import:android from another terminal.'
    ].join('\n'));
  }
}

export function assertAndroidDevice() {
  const output = execFileSync('adb', ['devices', '-l'], { encoding: 'utf8' });
  const devices = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices'))
    .filter((line) => /\bdevice\b/.test(line));

  if (!devices.length) {
    throw new Error([
      'No connected Android emulator was detected.',
      'Start the emulator first, then confirm npm run android:devices shows emulator-xxxx device.'
    ].join('\n'));
  }
}

export async function dumpAndroidState(client, prefix = 'android-current') {
  const xml = await client.getPageSource();
  const xmlPath = join(dataDir, `${prefix}.xml`);
  writeFileSync(xmlPath, xml, 'utf8');

  let screenshotPath = null;
  try {
    const base64 = await client.takeScreenshot();
    screenshotPath = join(dataDir, `${prefix}.png`);
    writeFileSync(screenshotPath, Buffer.from(base64, 'base64'));
  } catch {
    // Screenshots are useful but not required for text-based inspection.
  }

  return { xml, xmlPath, screenshotPath };
}

export function parseNodes(xml) {
  const nodes = [];
  const nodePattern = /<([a-zA-Z0-9_.]+)\b([^>]*)>/g;
  let match;

  while ((match = nodePattern.exec(xml))) {
    const attrs = parseAttributes(match[2]);
    const bounds = parseBounds(attrs.bounds);
    nodes.push({
      tag: match[1],
      text: decodeXml(attrs.text || ''),
      desc: decodeXml(attrs['content-desc'] || ''),
      id: attrs['resource-id'] || '',
      className: attrs.class || match[1],
      packageName: attrs.package || '',
      clickable: attrs.clickable === 'true',
      longClickable: attrs['long-clickable'] === 'true',
      scrollable: attrs.scrollable === 'true',
      enabled: attrs.enabled !== 'false',
      displayed: attrs.displayed !== 'false',
      bounds,
      raw: match[0]
    });
  }

  return nodes.filter((node) => node.displayed && node.bounds);
}

export function findBvids(text) {
  return [...new Set(String(text || '').match(/BV[a-zA-Z0-9]{10}/g) || [])];
}

export function visibleTextLines(nodes) {
  return nodes
    .map((node) => node.text || node.desc)
    .map((text) => text.trim())
    .filter(Boolean);
}

export async function swipeUp(client) {
  const { width, height } = await client.getWindowSize();
  await client.performActions([{
    type: 'pointer',
    id: 'finger1',
    parameters: { pointerType: 'touch' },
    actions: [
      { type: 'pointerMove', duration: 0, x: Math.floor(width / 2), y: Math.floor(height * 0.78) },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 120 },
      { type: 'pointerMove', duration: 650, x: Math.floor(width / 2), y: Math.floor(height * 0.25) },
      { type: 'pointerUp', button: 0 }
    ]
  }]);
  await client.releaseActions();
}

export async function tapNode(client, node) {
  await client.performActions([{
    type: 'pointer',
    id: 'finger1',
    parameters: { pointerType: 'touch' },
    actions: [
      { type: 'pointerMove', duration: 0, x: node.bounds.cx, y: node.bounds.cy },
      { type: 'pointerDown', button: 0 },
      { type: 'pause', duration: 80 },
      { type: 'pointerUp', button: 0 }
    ]
  }]);
  await client.releaseActions();
}

export function summarizeNodes(nodes, limit = 80) {
  return nodes
    .filter((node) => node.text || node.desc || node.clickable)
    .slice(0, limit)
    .map((node, index) => {
      const label = node.text || node.desc || '(no text)';
      const flags = [
        node.clickable ? 'clickable' : '',
        node.longClickable ? 'long' : '',
        node.scrollable ? 'scroll' : ''
      ].filter(Boolean).join(',');
      return `${index + 1}. ${node.className} ${JSON.stringify(label)} ${flags} ${formatBounds(node.bounds)} ${node.id}`;
    });
}

function parseAttributes(input) {
  const attrs = {};
  const attrPattern = /([\w:-]+)="([^"]*)"/g;
  let match;

  while ((match = attrPattern.exec(input))) {
    attrs[match[1]] = match[2];
  }

  return attrs;
}

function parseBounds(value) {
  const match = String(value || '').match(/\[(\d+),(\d+)]\[(\d+),(\d+)]/);
  if (!match) {
    return null;
  }

  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    cx: Math.floor((left + right) / 2),
    cy: Math.floor((top + bottom) / 2)
  };
}

function formatBounds(bounds) {
  return bounds ? `[${bounds.left},${bounds.top}][${bounds.right},${bounds.bottom}]` : '';
}

function decodeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function toFriendlyConnectError(error) {
  const message = error?.message || String(error);

  if (message.includes('ECONNREFUSED') || message.includes('Unable to connect')) {
    return [
      'Cannot connect to the Appium server.',
      'Run: npm run appium:start',
      'Keep that terminal open, then run android:inspect or import:android from another terminal.'
    ].join('\n');
  }

  if (message.includes('Could not find a connected Android device') || message.includes('No connected devices')) {
    return [
      'Appium is connected, but no Android device is available.',
      'Start the Android emulator first, then confirm adb devices -l shows an emulator device.'
    ].join('\n');
  }

  if (message.includes('uiautomator2') || message.includes('UiAutomator2')) {
    return [
      'The UiAutomator2 driver is unavailable.',
      'Run: npm run appium:setup'
    ].join('\n');
  }

  return message;
}
