/// <reference lib="webworker" />
// AudioWorklet：在音频线程里做 YIN 基频分析，每 10ms 把一帧结果发回主线程。
// 以 `?worker&url` 方式引入，由 Vite 单独打包。
import { FrameAnalyzer } from './FrameAnalyzer';

// AudioWorkletGlobalScope 的类型 TypeScript 没有内置，这里声明用到的部分
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

class PitchAnalyzerProcessor extends AudioWorkletProcessor {
  private readonly analyzer = new FrameAnalyzer(sampleRate, (frame) => this.port.postMessage(frame));

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) this.analyzer.push(channel);
    return true;
  }
}

registerProcessor('pitch-analyzer', PitchAnalyzerProcessor);
