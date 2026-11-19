import { describe, expect, it } from 'vitest';
import { appVersion, bumpFromLabels, next } from './version';

describe('版名', () => {
  it('タグがなければ v0.0.1 から始める', () => {
    expect(next([], 'patch')).toBe('v0.0.1');
    expect(next(['foo', 'v1.2'], 'minor')).toBe('v0.0.1');
  });
  it('最大のタグから上げる（文字列順ではなく数値順）', () => {
    const tags = ['v0.0.9', 'v0.0.10', 'v0.0.2'];
    expect(next(tags, 'patch')).toBe('v0.0.11');
    expect(next(tags, 'minor')).toBe('v0.1.0');
    expect(next(tags, 'major')).toBe('v1.0.0');
  });
  it('ラベルで上げ幅を決める', () => {
    expect(bumpFromLabels([])).toBe('patch');
    expect(bumpFromLabels(['semver:minor'])).toBe('minor');
    expect(bumpFromLabels(['semver:minor', 'semver:major'])).toBe('major');
  });
  it('APP_VERSION があればそのまま、なければ -dev を付ける', () => {
    expect(appVersion({ APP_VERSION: 'v0.3.1' })).toBe('v0.3.1');
    expect(appVersion({ APP_VERSION: 'bad' })).toMatch(/^v\d+\.\d+\.\d+-dev$/);
  });
});
