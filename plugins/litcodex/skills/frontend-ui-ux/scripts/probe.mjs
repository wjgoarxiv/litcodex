#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeBrowserDriver } from '../../browser-drive/scripts/capability-probe.mjs';
import { inspectPage } from './page-probe.mjs';
import { hoverCandidates, inspectHovered } from './hover-probe.mjs';
import { ALL_PROBE_RULES, CHECKED_RULES, LIMITS, VIEWPORTS } from './rule-data.mjs';

export const cases = VIEWPORTS;

const STATIC_RULES = Object.freeze([
  'SLOP-009', 'SLOP-008', 'SLOP-015', 'SLOP-016', 'SLOP-006', 'SLOP-024', 'CF-505',
  'SLOP-026', 'SLOP-057', 'SLOP-058', 'SLOP-060', 'SLOP-061', 'SLOP-012',
  'SLOP-040', 'SLOP-036', 'SLOP-039', 'CF-507', 'CF-106', 'CF-107', 'CF-503',
]);

function hueFromHex(value) {
  const hex = value.slice(1);
  const channels = (hex.length === 3 ? [...hex].map((part) => part + part) : hex.match(/../g)).slice(0, 3).map((part) => parseInt(part, 16) / 255);
  const high = Math.max(...channels), low = Math.min(...channels), delta = high - low;
  if (!delta) return { hue: 0, spread: 0 };
  const [red, green, blue] = channels;
  const hue = high === red ? ((green - blue) / delta) % 6 : high === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, spread: delta * 255 };
}

function violetLiteral(value) {
  if (/\b(?:violet|purple|fuchsia|indigo)\b/i.test(value)) return true;
  for (const match of value.matchAll(/#[\da-f]{3}(?:[\da-f]{3})?\b/gi)) {
    const color = hueFromHex(match[0]);
    if (color.hue >= LIMITS.accentPurpleHueMin && color.hue <= LIMITS.accentPurpleHueMax && color.spread >= LIMITS.accentPurpleChannelSpread) return true;
  }
  return [...value.matchAll(/(?:hsla?|oklch)\([^)]*?\b(\d{2,3})(?:deg)?\b[^)]*\)/gi)].some((match) => Number(match[1]) >= LIMITS.accentPurpleHueMin && Number(match[1]) <= LIMITS.accentPurpleHueMax);
}

export function staticFallback(source, file = '<source>') {
  const findings = [];
  const add = (rule, match, severity = 'LOW', tier = 'derived', note) => {
    findings.push({ rule, severity, tier, viewport: 'static', selector: `${file}:${source.slice(0, match.index).split('\n').length}`, value: match[0], threshold: 'review static signal', ...(note ? { note } : {}) });
  };
  const scan = (rule, pattern, severity = 'LOW', tier = 'derived', note) => {
    for (const match of source.matchAll(pattern)) add(rule, match, severity, tier, note);
  };
  for (const [rule, signal, severity, tier] of [
    ['SLOP-058', /href\s*=\s*["'](?:#|javascript:[^"']*)["']/gi, 'HIGH', 'derived'],
    ['CF-503', /scale(?:X|Y)?\(\s*0(?:\.\d+)?\s*\)/gi, 'LOW', 'derived'],
    ['SLOP-057', /<img\b[^>]*(?:src|srcset)\s*=\s*["'](?:|#[^"']*|undefined)["']/gi, 'HIGH', 'measured'],
    ['CF-507', /will-change\s*:\s*(?:all|width|height|margin|padding)/gi, 'LOW', 'derived'],
  ]) {
    for (const match of source.matchAll(signal)) {
      if (rule === 'CF-503' && Number(/\(([\d.]+)/.exec(match[0])?.[1]) >= LIMITS.entranceScaleMin) continue;
      add(rule, match, severity, tier);
    }
  }
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1], declarations = match[2];
    if (/background-clip\s*:\s*text/i.test(declarations) && /gradient\(/i.test(declarations)) add('SLOP-009', match, 'MEDIUM');
    if ((/(?:^|[\s,.>])h[1-6]\b|heading|title/i.test(selector) || /gradient\(/i.test(declarations)) && violetLiteral(declarations)) add('SLOP-008', match, 'MEDIUM');
    if (/(?:border-(?:left|top)\s*:\s*[2-9]\d*px|box-shadow\s*:[^;]*\b(?:[3-9]|1[0-2])px\s+0(?:px)?\b)/i.test(declarations)) add('SLOP-015', match, 'LOW');
    if (/background-image\s*:[^;]*repeating-(?:linear|radial)-gradient\(/i.test(declarations)) add('SLOP-012', match, 'MEDIUM');
  }
  scan('SLOP-015', /\b(?:border-l|border-t|border-left|border-top)-(?:[2-9]|1[0-2])\b/gi, 'LOW');
  const overusedFonts = /(?:Inter|Roboto|Open Sans|Lato|Montserrat|Arial|Helvetica|Fraunces|Mona Sans|Plus Jakarta Sans|Space Grotesk|Recoleta|Instrument Sans|Instrument Serif)/i;
  for (const match of source.matchAll(/(?:font-family\s*:\s*[^;}]+|fonts\.googleapis\.com\/css[^"'\s<]+)/gi)) {
    const first = /font-family\s*:\s*["']?([^,"';}]+)/i.exec(match[0])?.[1]?.trim();
    if (overusedFonts.test(first ?? match[0]) && !/^(?:Geist|Geist Sans|Geist Mono)$/i.test(first ?? '')) add('SLOP-016', match, 'LOW', 'derived', 'font match is a review candidate; rationale needs judgment');
  }
  const spacings = [...source.matchAll(/(?:gap|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?)\s*:[^;}]*?\b(\d+)px\b/gi)];
  if (spacings.length >= 10) {
    const buckets = spacings.reduce((counts, match) => counts.set(Math.round(Number(match[1]) / 4) * 4, (counts.get(Math.round(Number(match[1]) / 4) * 4) ?? 0) + 1), new Map());
    if (buckets.size <= 3 && Math.max(...buckets.values()) / spacings.length > 0.85) add('SLOP-006', spacings[0], 'LOW', 'derived', 'literal spacing candidate; rendered region count not verified');
  }
  const bounce = /(?:animation(?:-name)?\s*:[^;}]*\b(?:bounce|elastic|wobble|jiggle|spring)\b|animate-bounce|(?:type\s*:\s*["']spring["']|bounce\s*:\s*(?!0(?:\.0+)?\b)\d)|cubic-bezier\([^)]*\)|linear\([^)]*\))/gi;
  for (const match of source.matchAll(bounce)) {
    if (/cubic-bezier\(/i.test(match[0])) {
      const numbers = [...match[0].matchAll(/-?\d*\.?\d+/g)].map((item) => Number(item[0]));
      if (numbers.length < 4 || (numbers[1] >= -0.1 && numbers[1] <= 1.1 && numbers[3] >= -0.1 && numbers[3] <= 1.1)) continue;
    }
    if (/\blinear\(/i.test(match[0])) {
      const numbers = [...match[0].matchAll(/-?\d*\.?\d+/g)].map((item) => Number(item[0]));
      if (numbers.every((value) => value >= -0.1 && value <= 1.1)) continue;
    }
    add('CF-505', match, 'MEDIUM');
    add('SLOP-024', match, 'MEDIUM');
  }
  scan('SLOP-026', /transition(?:-property)?\s*:[^;}]*\b(?:width|height|padding|margin|top|left)\b/gi, 'MEDIUM');
  const text = source.replace(/<(?:style|script)\b[^>]*>[\s\S]*?<\/\s*(?:style|script)\s*>/gi, (part) => part.replace(/[^\n]/g, ' ')).replace(/<[^>]*>/g, (part) => part.replace(/[^\n]/g, ' '));
  scan('SLOP-061', /<marquee\b/gi, 'LOW', 'measured');
  if (/animation\s*:[^;}]*\binfinite\b/i.test(source) && !/\b(?:pause|stop)\b/i.test(text)) scan('SLOP-061', /@keyframes\s+[\w-]+[\s\S]{0,600}?translateX\(\s*100%\s*\)/gi, 'LOW');
  const copyScan = (rule, pattern, severity = 'LOW') => { for (const match of text.matchAll(pattern)) add(rule, match, severity, 'measured'); };
  copyScan('SLOP-060', /\b(?:lorem ipsum|\[placeholder\]|TODO)\b/gi);
  copyScan('SLOP-036', /\b(?:seamless experience|harness the power|best-in-class|unlock your potential|game-changing solution)\b/gi, 'MEDIUM');
  const dashes = [...text.matchAll(/—|&mdash;|&#8212;/gi)];
  if (dashes.length >= 8 && text.trim().length / dashes.length <= 500) add('SLOP-040', dashes[0], 'MEDIUM', 'measured');
  const cadence = [...text.matchAll(/\bNot an? [a-z][^.!]{1,40}[.!]\s+[A-Z][^.!]{1,60}[.!]|\b[A-Z][^.!]{4,80}[.!]\s+(?:No|Just) [a-z][^.!]{2,60}[.!]/g)];
  if (cadence.length >= 3) add('SLOP-039', cadence[0], 'LOW', 'measured');
  scan('SLOP-026', /@keyframes\s+[\w-]+\s*\{[^}]*\b(?:width|height|padding|margin|top|left)\s*:/gis, 'MEDIUM');
  scan('CF-107', /<(?:button|a|label)\b[^>]*>\s*(?:[A-Z][a-z]+\s+){2,}[A-Z][a-z]+\s*<\//g, 'LOW');
  const tabularPresent = /(?:tabular-nums|font-variant-numeric\s*:\s*tabular-nums|font-feature-settings\s*:[^;}]*["']tnum["'])/i.test(source);
  const notVerified = ALL_PROBE_RULES.filter((rule) => !findings.some((finding) => finding.rule === rule)).map((rule) => ({ rule, reason: rule === 'CF-106' && tabularPresent ? 'static fallback: tabular-nums source token found; numeric alignment needs rendered DOM' : 'static fallback: needs a rendered DOM or human review' }));
  return { manifest: { url: null, viewports_run: [], browser_version: null, not_verified: notVerified, screenshots: [], exit_code: 2, blocked_reason: 'browser unavailable' }, findings };
}

export function matrixExitCode(findings, viewports) {
  if (findings.some((finding) => finding.severity === 'HIGH' && finding.tier !== 'not_verified')) return 1;
  return VIEWPORTS.every((item) => viewports.includes(item.id)) ? 0 : 2;
}

function run(executable, args, options = {}) {
  return spawnSync(executable, args, { encoding: 'utf8', input: options.input, timeout: LIMITS.viewportBudgetMs, env: { ...process.env, ...(options.socketDir ? { AGENT_BROWSER_SOCKET_DIR: options.socketDir } : {}) } });
}

function resultValue(stdout) {
  const value = stdout.trim();
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'string') return parsed;
    try { return JSON.parse(parsed); } catch { return parsed; }
  } catch { /* browser CLI may print a wrapper */ }
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`eval did not return JSON: ${value.slice(0, 200)}`);
  const parsed = JSON.parse(value.slice(start, end + 1));
  if (typeof parsed !== 'string') return parsed;
  try { return JSON.parse(parsed); } catch { return parsed; }
}

export async function startServer(page, script = fileURLToPath(new URL('./serve-static.mjs', import.meta.url))) {
  const child = spawn(process.execPath, [script, resolve(page)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let detail = '';
  child.stderr.on('data', (bytes) => { detail += bytes.toString('utf8').slice(0, 500); });
  try {
    const url = await new Promise((fulfill, reject) => {
      const timer = setTimeout(() => reject(new Error(`server startup timed out: ${detail.trim()}`)), 5000);
      child.stdout.once('data', (bytes) => { clearTimeout(timer); fulfill(bytes.toString('utf8').trim()); });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(detail.trim() || `server exited ${code}`)); });
    });
    return { child, url };
  } catch (error) { child.kill('SIGTERM'); throw error; }
}

export async function probe(page, evidenceRoot, options = {}) {
  const capability = options.capability ?? probeBrowserDriver();
  const blocked = (reason, findings = [], notVerified = [], screenshots = [], viewports = [], url = null, detail = null) => ({
    manifest: { url, viewports_run: viewports, browser_version: capability.version ?? null, zoom_emulation: 'viewport-halved', not_verified: notVerified.length ? notVerified : ALL_PROBE_RULES.map((rule) => ({ rule, reason })), screenshots, exit_code: 2, blocked_reason: reason, ...(detail ? { detail } : {}) }, findings,
  });
  if (!capability.available) return blocked(capability.reason === 'identity-unverified' ? 'browser identity unverified' : 'browser unavailable');
  mkdirSync(evidenceRoot, { recursive: true });
  const source = inspectPage.toString();
  const hoverSource = hoverCandidates.toString();
  const inspectHoverSource = inspectHovered.toString();
  const findings = [];
  const notVerified = [];
  const screenshots = [];
  const viewports = [];
  const localUrl = /^https?:\/\/127\.0\.0\.1:\d+\//.test(page) ? page : null;
  let server = null;
  if (!localUrl) {
    try { if (!statSync(resolve(page)).isFile() || extname(page).toLowerCase() !== '.html') return blocked('no entry page found'); }
    catch (error) { return error.code === 'ENOENT' ? blocked('no entry page found') : blocked('browser unavailable', [], [], [], [], null, error.message); }
    try { server = await (options.serverStart ?? startServer)(page); }
    catch (error) { return blocked('browser unavailable', [], [], [], [], null, error.message); }
  }
  const target = localUrl ?? server.url;
  const session = `uiux-${process.pid}-${Date.now()}`;
  let socketDir;
  try { socketDir = mkdtempSync('/tmp/uiux-'); }
  catch { server?.child.kill('SIGTERM'); return blocked('browser unavailable', [], [], [], [], target); }
  const command = (args, options) => {
    const result = run(capability.command, ['--session', session, ...args], { ...options, socketDir });
    if (result.error || result.status !== 0) throw new Error(`${args.join(' ')}: ${(result.stderr?.trim() || result.error?.message || `exit ${result.status}`).slice(0, 300)}`);
    return result.stdout;
  };
  let outcome;
  try {
    const started = Date.now();
    let startupError = null;
    for (const item of cases) {
      if (Date.now() - started > LIMITS.totalBudgetMs) { for (const rule of ALL_PROBE_RULES) notVerified.push({ rule, viewport: item.id, reason: 'time budget exceeded' }); continue; }
      try {
        command(['set', 'viewport', String(item.width), String(item.height)]);
        command(['set', 'media', item.media, ...(item.reducedMotion ? ['reduced-motion'] : [])]);
        command(['open', target]);
        command(['wait', String(LIMITS.settleMs)]);
        const script = `JSON.stringify((${source})(${JSON.stringify(item)},${JSON.stringify(LIMITS)}))`;
        const observed = resultValue(command(['eval', '--stdin'], { input: script }));
        if (observed.readyState !== 'complete') {
          command(['wait', '200']);
          if (resultValue(command(['eval', '--stdin'], { input: 'JSON.stringify(document.readyState)' })) !== 'complete') throw new Error('page did not settle');
        }
        findings.push(...observed.findings);
        notVerified.push(...observed.notVerified);
        const shot = resolve(evidenceRoot, `${item.id}.png`);
        command(['screenshot', shot]);
        screenshots.push({ viewport: item.id, path: shot, bytes: statSync(shot).size, width: item.width, height: item.height });
        viewports.push(item.id);
        if (item.id === '390') {
          const candidates = resultValue(command(['eval', '--stdin'], { input: `JSON.stringify((${hoverSource})())` }));
          for (const selector of candidates) {
            try {
              command(['hover', selector]);
              const hovered = resultValue(command(['eval', '--stdin'], { input: `JSON.stringify((${inspectHoverSource})(${JSON.stringify(selector)},${JSON.stringify(item.id)},${JSON.stringify(LIMITS)}))` }));
              findings.push(...hovered.findings);
              if (hovered.notVerified) notVerified.push(hovered.notVerified);
            } catch (error) { notVerified.push({ rule: 'CF-506', viewport: item.id, reason: `hover failed: ${error.message}` }); }
          }
          if (!candidates.length) notVerified.push({ rule: 'CF-506', viewport: item.id, reason: 'no focusable control to hover' });
        }
      } catch (error) {
        if (!viewports.length && /^(?:set viewport|open )/.test(error.message)) startupError ??= error.message;
        for (const rule of ALL_PROBE_RULES) notVerified.push({ rule, viewport: item.id, reason: `matrix entry failed: ${error.message}` });
      }
    }
    const exitCode = matrixExitCode(findings, viewports);
    for (const rule of ALL_PROBE_RULES) if (!CHECKED_RULES.includes(rule) && !notVerified.some((entry) => entry.rule === rule && !entry.viewport)) notVerified.push({ rule, reason: 'manual judgment or automated check not implemented' });
    const missing = cases.filter((item) => !viewports.includes(item.id)).map((item) => item.id);
    outcome = exitCode === 2 && !viewports.length && startupError
      ? blocked('browser unavailable', findings, notVerified, screenshots, viewports, target, startupError)
      : { manifest: { url: target, viewports_run: viewports, browser_version: capability.version, zoom_emulation: 'viewport-halved', not_verified: notVerified, screenshots, exit_code: exitCode, ...(exitCode === 2 ? { blocked_reason: `matrix incomplete (${missing.join(',')})` } : {}) }, findings };
  } catch (error) {
    outcome = blocked(error.message, findings, notVerified, screenshots, viewports, target);
  } finally {
    const closed = run(capability.command, ['--session', session, 'close'], { socketDir });
    rmSync(socketDir, { recursive: true, force: true });
    if (server) {
      server.child.kill('SIGTERM');
      if (server.child.exitCode === null) await Promise.race([new Promise((fulfill) => server.child.once('exit', fulfill)), new Promise((fulfill) => setTimeout(fulfill, 2000))]);
    }
    if (closed.status !== 0 || (server && server.child.exitCode === null)) outcome = blocked('browser cleanup failed', findings, notVerified, screenshots, viewports, target);
  }
  return outcome;
}

export function formatProbeConsole(output, staticMode = false) {
  const stderr = [
    ...(output.manifest.detail ? [`Detail: ${output.manifest.detail}`] : []),
    ...(staticMode ? [`Static source checks: ${STATIC_RULES.length} rules (${STATIC_RULES.join(', ')}), ${output.findings.length} findings; rendered rules not verified`] : []),
  ];
  return { stdout: output.manifest.exit_code === 2 ? `BLOCKED: ${output.manifest.blocked_reason}\n` : `${JSON.stringify(output)}\n`, stderr: stderr.length ? `${stderr.join('\n')}\n` : '' };
}

let invokedDirectly = false;
try { invokedDirectly = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
catch { /* imported module or unresolved argv path */ }
if (invokedDirectly) {
  const option = (name) => process.argv[process.argv.indexOf(name) + 1];
  const staticIndex = process.argv.indexOf('--static');
  const pageIndex = process.argv.indexOf('--page');
  let output;
  if (staticIndex >= 0) output = staticFallback(readFileSync(resolve(option('--static')), 'utf8'), resolve(option('--static')));
  else if (pageIndex >= 0 && process.argv.includes('--evidence-root')) output = await probe(option('--page'), resolve(option('--evidence-root')));
  else { process.stderr.write('Usage: probe.mjs --page URL|FILE --evidence-root DIR | --static FILE\n'); process.exit(2); }
  if (process.argv.includes('--out')) writeFileSync(resolve(option('--out')), `${JSON.stringify(output, null, 2)}\n`);
  const consoleResult = formatProbeConsole(output, staticIndex >= 0);
  process.stdout.write(consoleResult.stdout);
  if (consoleResult.stderr) process.stderr.write(consoleResult.stderr);
  process.exit(output.manifest.exit_code);
}
