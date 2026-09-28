// Read-only candidate discovery; the driver performs a real pointer hover.
export function hoverCandidates() {
  const selectors = [];
  for (const element of document.querySelectorAll('a,button,input,select,textarea,[role="button"]')) {
    if (selectors.length >= 5) break;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height || element.matches(':disabled,[aria-disabled="true"]')) continue;
    const segments = [];
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const siblings = [...node.parentElement.children].filter((item) => item.tagName === node.tagName);
      segments.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
    }
    selectors.push(`body > ${segments.join(' > ')}`);
  }
  return selectors;
}

export function inspectHovered(selector, viewport, limits) {
  const element = document.querySelector(selector);
  if (!element || !element.matches(':hover')) return { notVerified: { rule: 'CF-506', viewport, reason: `hover state not reached: ${selector}` }, findings: [] };
  const style = getComputedStyle(element);
  const durations = style.transitionDuration.split(',').map((part) => part.trim().endsWith('ms') ? Number.parseFloat(part) : Number.parseFloat(part) * 1000);
  const findings = [];
  if (Math.max(0, ...durations) > limits.highFrequencyMotionMs) findings.push({ rule: 'CF-506', severity: 'LOW', tier: 'measured', viewport, selector, value: Math.max(...durations), threshold: limits.highFrequencyMotionMs });
  const wrong = style.willChange.split(',').map((part) => part.trim()).filter((part) => part && part !== 'auto' && !['transform', 'opacity', 'filter'].includes(part));
  if (wrong.length) findings.push({ rule: 'CF-507', severity: 'LOW', tier: 'measured', viewport, selector, value: wrong, threshold: 'transform|opacity|filter' });
  return { findings };
}
