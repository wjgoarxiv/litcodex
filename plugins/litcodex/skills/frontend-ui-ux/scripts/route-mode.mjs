// A selected skill uses this cue check; text alone never activates the picker skill.
const UI_OBJECT = /\b(?:ui|interface|screen|page|dashboard|form|button|card|layout|checkout|settings|profile|header|navigation)\b|화면|페이지|인터페이스|버튼|카드|레이아웃|폼|대시보드/iu;
const FOREIGN_OBJECT = /\b(?:video|slide|presentation|server|pipeline|infrastructure|paragraph|prose|essay|report draft)\b|영상|발표|슬라이드|서버|배포|문단|문장|보고서/iu;
const AUDIT = /\b(?:audit|review|just check|read.only|don't fix|do not fix)\b|점검|검토만|고치지|수정은 하지/iu;
const POLISH = /\b(?:polish|clean up the styling|tighten up)\b|다듬어/iu;
const HARDEN = /\b(?:harden|stress.test|hold up under|robust to)\b|튼튼하게|견고하게/iu;
const BUILD = /\b(?:build|create|implement|add|wire up|redesign|restructure|new component|brand.new)\b|만들어|구현해|추가해|새로 짜|다시 짜/iu;
const FIX = /\b(?:fix|repair|change|implement|apply)\b|고쳐|수정해|바꿔/iu;
const STRUCTURAL = /\b(?:redesign|restructure|new component|brand.new|build a new|create a new|add a new)\b|새로 짜|다시 짜|새 화면/iu;

export function routeFrontendMode(prompt, { selected = false, sameSurfaceSession = false } = {}) {
  if (!selected || typeof prompt !== 'string' || !UI_OBJECT.test(prompt) || (FOREIGN_OBJECT.test(prompt) && !/버튼|화면|페이지|screen|page|button|interface/iu.test(prompt))) return null;
  if (AUDIT.test(prompt) && (!FIX.test(prompt) || /\b(?:do not|don't|without)\s+fix\b|고치지|수정은 하지/iu.test(prompt))) return sameSurfaceSession ? 'audit' : 'visual-qa';
  if (STRUCTURAL.test(prompt)) return 'build';
  if (HARDEN.test(prompt)) return 'harden';
  if (POLISH.test(prompt)) return 'polish';
  if (BUILD.test(prompt) || FIX.test(prompt)) return 'build';
  return 'build';
}
