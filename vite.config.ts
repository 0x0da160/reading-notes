/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cspPlugin, serviceWorkerPlugin } from './build/plugins';

// GitHub Pages の公開パス /<repo>/（§1, §8）
const base = process.env.BASE_PATH ?? '/reading-notes/';

export default defineConfig({
  base,
  plugins: [react(), cspPlugin(), serviceWorkerPlugin()],
  build: {
    target: 'es2022',
    // 初版はコード分割しない（§2）
    modulePreload: false,
    assetsInlineLimit: 0,
    rolldownOptions: { output: { codeSplitting: false } },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
