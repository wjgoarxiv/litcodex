import { describe, expect, it } from 'vitest';
import { routeFrontendMode } from './scripts/route-mode.mjs';

describe('selected frontend skill mode routing', () => {
  it.each([
    ['Build a settings screen with a save button', 'build'],
    ['새 프로필 화면을 만들어줘', 'build'],
    ['Polish the existing settings screen spacing', 'polish'],
    ['이 화면 그대로 두고 여백만 다듬어줘', 'polish'],
    ['Harden the settings screen against empty data', 'harden'],
    ['이 화면 튼튼하게 만들어줘', 'harden'],
    ['Audit this page and do not fix it', 'audit'],
    ['이 화면 점검만 해줘', 'audit'],
  ])('%s routes to %s with same-surface context', (prompt, expected) => {
    expect(routeFrontendMode(prompt, { selected: true, sameSurfaceSession: true })).toBe(expected);
  });

  it('hands a cold audit to independent visual review', () => {
    expect(routeFrontendMode('Audit this page, read-only', { selected: true })).toBe('visual-qa');
  });

  it.each([
    'Cut this demo video down to ninety seconds',
    '이 인트로 영상에 자막 넣어줘',
    '발표 슬라이드 디자인 다듬어줘',
    '이 문단 다듬어줘',
    '서버 상태 점검 좀 해줘',
    '모션을 저사양 기기에 맞게 최적화해줘',
  ])('does not select a frontend route for %s', (prompt) => {
    expect(routeFrontendMode(prompt, { selected: true, sameSurfaceSession: true })).toBeNull();
  });

  it('never treats prompt text alone as picker activation', () => {
    expect(routeFrontendMode('Polish this page')).toBeNull();
  });

  it('promotes structural edits and audit-then-fix to build', () => {
    expect(routeFrontendMode('Polish this page but add a new component', { selected: true })).toBe('build');
    expect(routeFrontendMode('Audit this page and fix the problems', { selected: true })).toBe('build');
  });
});
