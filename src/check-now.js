import { checkAllVideos } from './checker.js';

const results = await checkAllVideos();

for (const { video, result } of results) {
  console.log(`${video.bvid}\t${result.status}\t${result.detail}`);
}

console.log(`Checked ${results.length} video(s).`);
