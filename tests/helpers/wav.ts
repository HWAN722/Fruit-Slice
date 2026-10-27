import { readFileSync } from 'node:fs';

/** 读取 16 位 PCM 单声道 WAV（测试夹具用），返回 -1..1 的采样 */
export function readWav(path: string): { samples: Float32Array; sampleRate: number } {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`不是 WAV：${path}`);
  let offset = 12;
  let sampleRate = 0;
  let bits = 0;
  let channels = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bits = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      if (bits !== 16 || channels !== 1) throw new Error(`只支持 16 位单声道：${path}`);
      const n = size / 2;
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(body + i * 2) / 32768;
      return { samples, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`没有 data 块：${path}`);
}
