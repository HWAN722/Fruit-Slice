/**
 * 声调分类的离线测试：用 tests/fixtures/tones/ 下的标准四声录音。
 * 目前的录音是 Windows 自带中文语音（Huihui）合成的，分正常、调高（模拟儿童）、调低（模拟男声）三套。
 * 验收标准：准确率 ≥ 85%。
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Tone } from '../src/match/normalize';
import { rangeFromPitches, type VoiceRange } from '../src/tone/Calibration';
import { analyzeSamples } from '../src/tone/FrameAnalyzer';
import { SyllableSegmenter, type SyllableSegment } from '../src/tone/SyllableSegmenter';
import { classifyTone } from '../src/tone/ToneClassifier';
import { readWav } from './helpers/wav';

const ROOT = join(__dirname, 'fixtures', 'tones');
const VOICES = readdirSync(ROOT);
/** 校准用的字：和游戏里的校准流程一样，读"妈 麻 马 骂" */
const CALIBRATION_SET = 'ma';

function segmentsOf(file: string): SyllableSegment[] {
  const { samples, sampleRate } = readWav(file);
  const seg = new SyllableSegmenter();
  const out: SyllableSegment[] = [];
  for (const f of analyzeSamples(samples, sampleRate)) out.push(...seg.feed(f));
  out.push(...seg.flush());
  return out;
}

/** 一个文件读的是一个字：取最长的音节 */
function mainSegment(file: string): SyllableSegment | null {
  return segmentsOf(file).sort((a, b) => b.end - b.start - (a.end - a.start))[0] ?? null;
}

function calibrate(voice: string): VoiceRange {
  const hz: number[] = [];
  for (let t = 1; t <= 4; t++) {
    const s = mainSegment(join(ROOT, voice, `${CALIBRATION_SET}${t}.wav`));
    for (const f of s?.frames ?? []) if (f.f0 !== null && f.confidence >= 0.5) hz.push(f.f0);
  }
  const range = rangeFromPitches(hz);
  if (!range) throw new Error(`${voice} 校准失败`);
  return range;
}

describe('声调分类（标准录音）', () => {
  const results: { voice: string; file: string; expected: Tone; got: Tone | null; confidence: number }[] = [];

  for (const voice of VOICES) {
    it(`${voice}：每个录音都能切出音节`, () => {
      const range = calibrate(voice);
      for (const file of readdirSync(join(ROOT, voice))) {
        const m = /^([a-z]+)([1-4])\.wav$/.exec(file);
        if (!m || m[1] === CALIBRATION_SET) continue;
        const seg = mainSegment(join(ROOT, voice, file));
        expect(seg, `${voice}/${file}`).not.toBeNull();
        const r = seg ? classifyTone(seg, range) : null;
        results.push({ voice, file, expected: Number(m[2]) as Tone, got: r?.tone ?? null, confidence: r?.confidence ?? 0 });
      }
    });
  }

  it('准确率 ≥ 85%', () => {
    const correct = results.filter((r) => r.got === r.expected).length;
    const accuracy = correct / results.length;
    const wrong = results
      .filter((r) => r.got !== r.expected)
      .map((r) => `${r.voice}/${r.file}→${r.got}(${r.confidence.toFixed(2)})`);
    console.log(`声调准确率 ${(accuracy * 100).toFixed(1)}%（${correct}/${results.length}）错：${wrong.join(' ')}`);
    expect(results.length).toBeGreaterThan(50);
    expect(accuracy).toBeGreaterThanOrEqual(0.85);
  });

  it('高置信度的判断几乎都对（低置信度时游戏不判错，不会冤枉玩家）', () => {
    const confident = results.filter((r) => r.confidence >= 0.6);
    const wrong = confident.filter((r) => r.got !== r.expected);
    console.log(`置信度 ≥ 0.6：${confident.length} 个，其中错 ${wrong.length} 个`);
    expect(wrong.length / Math.max(1, confident.length)).toBeLessThanOrEqual(0.05);
  });
});
