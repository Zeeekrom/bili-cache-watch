import { connectAndroid, dumpAndroidState, findBvids, parseNodes, summarizeNodes, visibleTextLines } from './android.js';

const client = await connectAndroid();

try {
  const { xml, xmlPath, screenshotPath } = await dumpAndroidState(client);
  const nodes = parseNodes(xml);
  const text = visibleTextLines(nodes).join('\n');
  const bvids = findBvids(xml);
  const activity = await client.getCurrentActivity().catch(() => null);
  const pkg = await client.getCurrentPackage().catch(() => null);

  console.log(`Package: ${pkg || 'unknown'}`);
  console.log(`Activity: ${activity || 'unknown'}`);
  console.log(`XML: ${xmlPath}`);
  if (screenshotPath) {
    console.log(`Screenshot: ${screenshotPath}`);
  }
  console.log(`Visible text lines: ${visibleTextLines(nodes).length}`);
  console.log(`Visible BV ids: ${bvids.length ? bvids.join(', ') : '(none)'}`);
  console.log('\nVisible controls:');
  console.log(summarizeNodes(nodes).join('\n'));

  if (!text.includes('缓存') && !text.toLowerCase().includes('download')) {
    console.log('\nHint: 当前页面不像缓存列表。请在模拟器里手动进入 Bilibili 的缓存/离线缓存页后再运行导入。');
  }
} finally {
  await client.deleteSession();
}
