import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5173 },
  // vosk-browser（离线识别，约 6MB，内含 wasm）单独成块、按需加载，不必为它报警
  build: { chunkSizeWarningLimit: 6000 },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
