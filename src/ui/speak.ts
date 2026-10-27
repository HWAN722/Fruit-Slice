/** 用浏览器的语音合成读汉字（结算页复习用）。Windows / macOS 自带中文语音，不需要联网 */

function chineseVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  // 优先本地语音（不依赖网络），其次任何中文语音
  return (
    voices.find((v) => v.lang.replace('_', '-').startsWith('zh-CN') && v.localService) ??
    voices.find((v) => v.lang.replace('_', '-').startsWith('zh')) ??
    null
  );
}

/** 有可用的中文语音；语音列表是异步加载的，onChange 会在加载完后回调 */
export function canSpeakChinese(onChange?: () => void): boolean {
  if (typeof speechSynthesis === 'undefined') return false;
  if (onChange) speechSynthesis.addEventListener('voiceschanged', onChange, { once: true });
  return chineseVoice() !== null;
}

export function speakChinese(text: string): void {
  const voice = chineseVoice();
  if (!voice) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.8; // 慢一点，方便跟读
  speechSynthesis.speak(u);
}
