// 版名（例：v0.0.1、開発中は v0.0.2-dev）。ビルド時に埋め込む（build/version.ts）。
declare const __APP_VERSION__: string;
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'v0.0.0-dev';
