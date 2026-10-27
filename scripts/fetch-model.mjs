// 下载 Vosk 中文小模型，并重新打包成 vosk-browser 需要的 tar.gz（第一层是模型目录）
// 用法：npm run setup:model
import { unzipSync } from 'fflate';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from 'tar';

const MODEL = 'vosk-model-small-cn-0.22';
const URL = `https://alphacephei.com/vosk/models/${MODEL}.zip`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'models');
const outFile = join(outDir, `${MODEL}.tar.gz`);
const tmpDir = join(root, 'node_modules', '.cache', 'vosk-model');

if (existsSync(outFile) && !process.argv.includes('--force')) {
  console.log(`模型已存在：${outFile}（加 --force 重新下载）`);
  process.exit(0);
}

console.log(`下载 ${URL} …`);
const res = await fetch(URL);
if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`);
const total = Number(res.headers.get('content-length')) || 0;
const chunks = [];
let received = 0;
let lastPct = -1;
for await (const chunk of res.body) {
  chunks.push(chunk);
  received += chunk.length;
  const pct = total ? Math.floor((received / total) * 100) : -1;
  if (pct !== lastPct && pct % 10 === 0) {
    console.log(`  ${pct}%`);
    lastPct = pct;
  }
}
const zip = new Uint8Array(received);
let offset = 0;
for (const c of chunks) {
  zip.set(c, offset);
  offset += c.length;
}

console.log('解压…');
rmSync(tmpDir, { recursive: true, force: true });
const files = unzipSync(zip);
for (const [name, data] of Object.entries(files)) {
  if (name.endsWith('/')) continue;
  const path = join(tmpDir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}
if (!existsSync(join(tmpDir, MODEL))) throw new Error(`压缩包里没有 ${MODEL}/ 目录`);

console.log('打包…');
mkdirSync(outDir, { recursive: true });
await create({ gzip: true, file: outFile, cwd: tmpDir, portable: true }, [MODEL]);
rmSync(tmpDir, { recursive: true, force: true });
console.log(`完成：${outFile}`);
