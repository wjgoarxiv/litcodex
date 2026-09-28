// Self-contained because agent-browser evaluates its serialized function in the page.
export function inspectPage(viewport, limits) {
  const findings = [];
  const notVerified = [];
  const counts = new Map();
  const add = (rule, severity, element, value, threshold, tier = 'measured', note) => {
    const count = counts.get(rule) ?? 0;
    if (count >= limits.findingCapPerRule) return;
    counts.set(rule, count + 1);
    findings.push({ rule, severity, tier, viewport: viewport.id, selector: element ? selectorFor(element) : 'html', value, threshold, ...(note ? { note } : {}) });
  };
  const unknown = (rule, reason) => {
    if (!notVerified.some((item) => item.rule === rule)) notVerified.push({ rule, viewport: viewport.id, reason });
  };
  const selectorFor = (element) => {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const tag = element.tagName.toLowerCase();
    const classes = [...element.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join('');
    return `${tag}${classes}`;
  };
  const parseRgb = (value) => {
    const match = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);
    return match ? match.slice(1, 4).map(Number) : null;
  };
  const luminance = (rgb) => rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const hueAndSaturation = (rgb) => {
    const [red, green, blue] = rgb.map((channel) => channel / 255);
    const high = Math.max(red, green, blue), low = Math.min(red, green, blue), delta = high - low;
    if (!delta) return [0, 0];
    const hue = high === red ? ((green - blue) / delta) % 6 : high === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
    return [(hue * 60 + 360) % 360, high ? delta / high : 0];
  };
  const background = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.backgroundImage !== 'none') return null;
      const color = parseRgb(style.backgroundColor);
      if (color && !/rgba\([^)]*,\s*0\s*\)/.test(style.backgroundColor)) return color;
    }
    return [255, 255, 255];
  };
  const width = innerWidth;
  const lineCount = (element) => {
    const tops = new Set();
    for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const box of range.getClientRects()) if (box.width > 0) tops.add(Math.round(box.top));
    }
    return tops.size;
  };
  const authoredDeclarations = (element) => {
    const declarations = [element.getAttribute('style') ?? ''];
    let opaque = false;
    const inspectRules = (rules) => {
      for (const rule of rules) {
        if (rule.selectorText) {
          try { if (element.matches(rule.selectorText)) declarations.push(rule.style.cssText); } catch { /* unsupported selector */ }
        } else if (rule.cssRules) inspectRules(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try { inspectRules(sheet.cssRules); } catch { opaque = true; }
    }
    return { text: declarations.join(';'), opaque };
  };
  const longestLine = (element) => {
    const byTop = new Map();
    let seen = 0;
    for (const node of element.childNodes) if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      const range = document.createRange();
      for (let index = 0; index < node.textContent.length && seen < limits.textCap; index++, seen++) {
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width) {
          const key = Math.round(rect.top);
          byTop.set(key, (byTop.get(key) ?? 0) + 1);
        }
      }
    }
    return Math.max(0, ...byTop.values());
  };
  const cjk = (value) => [...value].filter((char) => /[\u3130-\u318f\uac00-\ud7af\u3400-\u9fff]/u.test(char)).length / Math.max(1, [...value].length) > 0.3;
  const leading = (style) => style.lineHeight === 'normal' ? 1.15 : Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize);
  const accents = [];
  const textBoxes = [];
  const controls = [];
  const fonts = new Set();
  const typeRoles = new Set();
  const spacingValues = new Set();
  const eyebrowCandidates = [];
  const headings = [];
  const glows = [];
  const stripeScopes = [];
  const gridCandidates = [];
  const numericLabels = new Set();
  const overflow = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - width;
  if (overflow > limits.overflowPx) add('RS-006', 'HIGH', null, overflow, limits.overflowPx);
  if (viewport.zoomEmulation && overflow > limits.overflowPx) add('RS-004', 'HIGH', null, overflow, limits.overflowPx, 'derived');

  for (const element of [...document.querySelectorAll('body *')].slice(0, limits.elementCap)) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight || element.closest('[aria-hidden="true"],[hidden],[inert]')) continue;
    const text = element.textContent?.trim() ?? '';
    const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    const localText = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent.trim()).join(' ').trim();
    const lines = ownText ? lineCount(element) : 0;
    const fontSize = Number.parseFloat(style.fontSize);
    if (ownText) {
      fonts.add(style.fontFamily.split(',')[0].replace(/["']/g, '').trim());
      if (!element.closest('form') && !element.matches('input,textarea,select')) typeRoles.add(`${style.fontFamily.split(',')[0].replace(/["']/g, '').trim()}|${Math.round(fontSize)}|${Math.floor(Number.parseInt(style.fontWeight, 10) / 100) * 100}`);
      textBoxes.push({ element, rect });
      if (element.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')) headings.push(element);
      if (localText.length < 30 && (style.textTransform === 'uppercase' || Number.parseFloat(style.letterSpacing) > 1)) eyebrowCandidates.push(element);
    }
    for (const property of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'columnGap', 'rowGap']) {
      const value = Number.parseFloat(style[property]);
      if (value > 0 && Number.isFinite(value)) spacingValues.add(Math.round(value));
    }
    if (ownText && lines >= 2 && element.matches('p,blockquote,dd,li,td') && !element.closest('nav,footer')) {
      const floor = cjk(localText) ? limits.bodyLeadingCjk : limits.bodyLeadingLatin;
      if (leading(style) < floor) add('CF-103', 'MEDIUM', element, Number(leading(style).toFixed(2)), floor);
      if (lines >= 3 && leading(style) < limits.wrappedRowLeading) add('CF-104', 'MEDIUM', element, Number(leading(style).toFixed(2)), limits.wrappedRowLeading);
      const measure = longestLine(element);
      const measureMax = cjk(localText) ? limits.lineMeasureCjkMax : limits.lineMeasureLatinMax;
      if (measure > measureMax) add('CF-101', 'MEDIUM', element, measure, measureMax);
    }
    if (ownText && lines >= 2 && element.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
      const floor = fontSize >= limits.heroSizePx ? limits.heroLeadingMin : limits.headingLeadingMin;
      if (leading(style) < floor || (fontSize < limits.heroSizePx && leading(style) > limits.headingLeadingMax)) add('CF-102', 'MEDIUM', element, Number(leading(style).toFixed(2)), [floor, limits.headingLeadingMax]);
    }
    if (ownText && fontSize < 18 && Number.parseInt(style.fontWeight, 10) < 400) add('CF-109', 'MEDIUM', element, Number.parseInt(style.fontWeight, 10), 400);
    if (ownText && /\d/u.test(localText) && element.closest('table,[role="table"],[data-kpi],[aria-live]') && !/mono/i.test(style.fontFamily) && !/tabular-nums/.test(style.fontVariantNumeric) && !/['"]tnum['"]/.test(style.fontFeatureSettings)) add('CF-106', 'LOW', element, style.fontVariantNumeric, 'tabular numerals');
    if (ownText && text && !element.matches('.sr-only,.visually-hidden') && rect.width * rect.height >= 4 && /^(hidden|clip|ellipsis)$/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1 && style.textOverflow !== 'ellipsis' && !style.webkitLineClamp && !style.lineClamp) {
      add('RS-007', element.closest('main,article,h1,h2,h3') ? 'HIGH' : 'MEDIUM', element, element.scrollWidth - element.clientWidth, 0);
    }
    if (ownText && text && /^(hidden|clip)$/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1 && !style.webkitLineClamp && !style.lineClamp && !element.closest('details:not([open])')) add('RS-007', 'HIGH', element, element.scrollHeight - element.clientHeight, 0);
    if (ownText && text && style.color && Number(style.opacity) > 0) {
      const foreground = parseRgb(style.color);
      if (!background(element)) unknown('CF-204', `image or gradient ground at ${selectorFor(element)} needs a pixel sample`);
      if (foreground && background(element)) {
        const light = [luminance(foreground), luminance(background(element))].sort((a, b) => b - a);
        const ratio = (light[0] + 0.05) / (light[1] + 0.05);
        const large = Number.parseFloat(style.fontSize) >= limits.largeTextPx || (Number.parseFloat(style.fontSize) >= limits.boldLargeTextPx && Number.parseInt(style.fontWeight, 10) >= 700);
        const floor = large ? limits.largeContrast : limits.bodyContrast;
        if (ratio < floor) add('CF-201', large ? 'MEDIUM' : 'HIGH', element, Number(ratio.toFixed(2)), floor, 'derived');
      }
    }
    if (element.matches('a,button,input,select,textarea,[role="button"]') && !element.matches(':disabled,[aria-disabled="true"]')) {
      controls.push({ element, rect });
      const name = (element.getAttribute('aria-label') || element.getAttribute('alt') || element.getAttribute('title') || element.labels?.[0]?.textContent || element.textContent || '').trim();
      if (!name && !element.getAttribute('aria-labelledby')) add('CF-603', 'HIGH', element, 'empty accessible name', 'non-empty accessible name');
      const size = Math.min(rect.width, rect.height);
      const spaced = controls.slice(0, -1).every((other) => {
        const x = Math.max(0, Math.max(other.rect.left - rect.right, rect.left - other.rect.right));
        const y = Math.max(0, Math.max(other.rect.top - rect.bottom, rect.top - other.rect.bottom));
        return Math.hypot(x, y) >= limits.touchTargetPx;
      });
      if (size < limits.hitFloorPx && !spaced) add('CF-701', 'HIGH', element, Number(size.toFixed(1)), limits.hitFloorPx);
      else if (viewport.width <= limits.touchPrimaryMaxWidthPx && size < limits.touchTargetPx && !spaced) add('CF-701', element.matches('.primary,.btn-primary,[data-primary]') ? 'HIGH' : 'MEDIUM', element, Number(size.toFixed(1)), limits.touchTargetPx);
      if (viewport.width <= limits.mobileInputMaxWidthPx && element.matches('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"]):not([type="button"]):not([type="submit"]),textarea,[contenteditable="true"]') && fontSize < limits.mobileInputPx) add('RS-008', 'MEDIUM', element, fontSize, limits.mobileInputPx);
      if (element.matches('input[placeholder],textarea[placeholder]') && !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')) add('CF-806', 'MEDIUM', element, element.getAttribute('placeholder'), 'accessible label');
    }
    if (element.matches('button:not([type])') && element.form && [...document.querySelectorAll('button,input[type="submit"],input[type="image"]')].filter((button) => button.form === element.form && button.matches('button:not([type="button"]):not([type="reset"]),input[type="submit"],input[type="image"]')).length >= 2) add('SLOP-059', 'HIGH', element, 'ambiguous implicit submit', 'explicit type');
    if (element.matches('img') && (!element.getAttribute('src') && !element.getAttribute('srcset') || /^(?:#|undefined)$/i.test(element.getAttribute('src') ?? '') || /^(?:#|undefined)$/i.test(element.getAttribute('srcset') ?? '') || (element.complete && element.naturalWidth === 0)) && ![...element.attributes].some((attribute) => /^data-(?:src|srcset|lazy)/.test(attribute.name))) {
      if (element.loading === 'lazy' && !element.complete) unknown('SLOP-057', `lazy image at ${selectorFor(element)} has not fetched`);
      else if (element.complete || !element.loading || element.loading !== 'lazy') add('SLOP-057', 'HIGH', element, element.getAttribute('src'), 'valid decoding image');
    }
    if (element.matches('marquee')) add('SLOP-061', 'LOW', element, 'marquee', 'static row or pause control');
    if (ownText && element.matches('h2,h3,h4') && /^0?[1-9]\d?\b/.test(localText)) numericLabels.add(/^0?[1-9]\d?/.exec(localText)[0]);
    if (element.matches('progress,meter,[role="progressbar"],[role="meter"]') && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.querySelector('text,[role="note"]') && !/\d/.test(element.textContent ?? '')) unknown('SLOP-046', `unlabeled gauge candidate at ${selectorFor(element)} needs data-origin review`);
    if (element.matches('section,article,div') && /gradient\(/.test(style.backgroundImage) && /\d+px/.test(style.backgroundSize)) {
      const gradients = (style.backgroundImage.match(/gradient\(/g) ?? []).length;
      if (gradients >= limits.gridHairlineLayers || /radial-gradient\(/.test(style.backgroundImage)) {
        const region = element.closest('section,main,article,[role="region"]') ?? element;
        const data = region.querySelector('canvas,table,[role="table"],[role="grid"],[role="img"]') || [...region.querySelectorAll('svg')].some((svg) => { const box = svg.getBoundingClientRect(); return box.width > limits.dataSvgMinPx && box.height > limits.dataSvgMinPx; });
        if (!data) gridCandidates.push(element);
      }
    }
    if (document.querySelector('meta[name="viewport"][content*="viewport-fit=cover"]') && ['fixed', 'sticky'].includes(style.position) && element.querySelector('a,button,input,select,textarea,[role="button"]') && (rect.top <= limits.safeEdgePx || rect.bottom >= innerHeight - limits.safeEdgePx || rect.left <= limits.safeEdgePx || rect.right >= innerWidth - limits.safeEdgePx)) {
      const declarations = authoredDeclarations(element);
      if (declarations.opaque && !declarations.text.trim()) unknown('RS-009', `cross-origin style at ${selectorFor(element)} cannot be inspected`);
      else if (!/env\(safe-area-inset-(?:top|right|bottom|left)\)/.test(declarations.text)) add('RS-009', 'MEDIUM', element, 'no authored safe-area inset', 'env(safe-area-inset-*)', 'derived');
    }
    if (/(?:auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + limits.overflowPx) {
      const hasCue = element.querySelector('button,[role="tab"],[aria-controls]') || (element.id && document.querySelector(`[aria-controls="${CSS.escape(element.id)}"]`)) || /\b\d+\s*\/\s*\d+\b/.test(element.textContent ?? '');
      if (!hasCue) {
        const visibleEdge = rect.right;
        const peeks = [...element.children].map((child) => child.getBoundingClientRect()).filter((box) => box.left < visibleEdge && box.right > visibleEdge).map((box) => visibleEdge - box.left);
        if (!peeks.some((peek) => peek >= limits.railPeekMinPx && peek <= limits.railPeekMaxPx)) add('RS-010', 'LOW', element, peeks, [limits.railPeekMinPx, limits.railPeekMaxPx]);
      }
    }
    if (element.matches('div,section,article') && style.display === 'grid' && !element.closest('ul,ol,table')) {
      const tiles = [...element.children].filter((child) => child.querySelector('svg,img') && child.querySelector('h2,h3,h4,h5,h6,[role="heading"]') && child.querySelector('p,small,span'));
      if (tiles.length >= limits.tileMinSiblings) {
        const sizes = tiles.map((tile) => tile.getBoundingClientRect());
        const alike = sizes.every((box) => Math.abs(box.width - sizes[0].width) <= limits.tileTolerancePx && Math.abs(box.height - sizes[0].height) <= limits.tileTolerancePx);
        if (alike) add('SLOP-002', 'MEDIUM', element, tiles.length, limits.tileMinSiblings);
      }
    }
    if (element.matches('section,article,div') && element.children.length >= limits.statWithCtaMinSiblings && element.children.length <= limits.statMaxSiblings) {
      const blocks = [...element.children].filter((child) => {
        const leaves = [...child.querySelectorAll('*')].filter((node) => node.children.length === 0 && /\d/.test(node.textContent ?? ''));
        return leaves.some((leaf) => Number.parseFloat(getComputedStyle(leaf).fontSize) >= limits.statFontRatio * Number.parseFloat(getComputedStyle(child).fontSize));
      });
      const min = element.querySelector('a,button') ? limits.statWithCtaMinSiblings : limits.statMinSiblings;
      if (blocks.length >= min) unknown('SLOP-045', `${blocks.length} stat siblings at ${selectorFor(element)} need source review`);
    }
    if (viewport.width === limits.tickerViewportWidthPx && element.matches('section,article,div') && element.getAnimations().some((animation) => animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity && animation.effect?.getKeyframes().some((key) => /translateX?\(/.test(key.transform ?? '')))) {
      const logos = [...element.querySelectorAll('img,svg')];
      const sources = new Set(logos.map((logo) => logo.currentSrc || logo.outerHTML));
      const heights = logos.map((logo) => logo.getBoundingClientRect().height).sort((a,b) => a-b);
      if (sources.size >= limits.tickerMinLogos && sources.size <= limits.tickerMaxLogos && heights.length && heights[Math.floor(heights.length/2)] < limits.smallLogoMaxPx) add('SLOP-047', 'MEDIUM', element, { logos: sources.size, medianHeight: heights[Math.floor(heights.length/2)] }, { maxLogos: limits.tickerMaxLogos, minHeight: limits.smallLogoMaxPx });
    }
    if (element.matches('[data-autoplay],[data-bs-ride="carousel"],[autoplay]') && element.querySelectorAll('button,[role="tab"],.dot,.indicator').length >= 2) {
      const dots = [...element.querySelectorAll('button,[role="tab"],.dot,.indicator')].filter((dot) => {
        const box = dot.getBoundingClientRect();
        return box.width <= limits.tinyDotMaxPx && box.height <= limits.tinyDotMaxPx;
      });
      const bound = dots.every((dot) => dot.matches('button,[role="button"],[role="tab"]') && (dot.getAttribute('aria-label') || dot.textContent.trim() || dot.getAttribute('aria-controls') || dot.getAttribute('aria-selected') || dot.getAttribute('aria-current')));
      if (dots.length >= 2 && !bound) add('SLOP-048', 'LOW', element, dots.length, 'accessible slide picker');
    }
    if (ownText && /\b(?:lorem ipsum|\[placeholder\]|TODO)\b/i.test(localText)) add('SLOP-060', 'LOW', element, localText.slice(0, 80), 'specific copy');
    if (ownText && style.textTransform === 'uppercase' && localText.length > limits.uppercaseTextChars && !cjk(localText)) add('SLOP-020', 'LOW', element, localText.length, limits.uppercaseTextChars);
    if (ownText && (localText.match(/·/g)?.length ?? 0) >= limits.middleDotCount) add('SLOP-033', 'LOW', element, localText.match(/·/g).length, limits.middleDotCount);
    if (ownText && /\bscroll (?:down|to explore)\b|아래로 스크롤/iu.test(localText) && rect.top < innerHeight) add('SLOP-035', 'LOW', element, localText.slice(0, 60), 'remove redundant cue');
    const authoredCopy = localText.replace(/\b\d[\d:/.-]*\s+–\s+\d[\d:/.-]*\b/g, '');
    if (ownText && (/[—]/u.test(authoredCopy) || /\s–\s/u.test(authoredCopy)) && !element.closest('pre,code,kbd,form,blockquote[cite^="http"],q[cite^="http"]')) add('SLOP-040', 'MEDIUM', element, authoredCopy.slice(0, 80), 'review separator punctuation', 'derived');
    if (ownText && /\b(?:seamless experience|unlock your potential|cutting.edge innovation)\b/i.test(localText)) add('SLOP-036', 'MEDIUM', element, localText.slice(0, 80), 'specific copy');
    if (ownText && element.matches('a,button,label,[role="button"]') && /\b(?:Of|And|The|To|For|In)\b/u.test(localText) && /\b[A-Z][a-z]{3,}/u.test(localText)) add('CF-107', 'LOW', element, localText.slice(0, 80), 'sentence case');
    if (ownText && /[\u{1f300}-\u{1faff}]/u.test(localText) && element.closest('button,nav,[role="button"],.badge')) unknown('SLOP-053', `emoji icon candidate at ${selectorFor(element)} needs policy review`);
    if (element.matches('svg')) {
      const primitives = element.querySelectorAll('rect,circle,ellipse,polygon').length;
      const fills = new Set([...element.querySelectorAll('rect,circle,ellipse,polygon')].map((shape) => getComputedStyle(shape).fill).filter((fill) => fill !== 'none' && fill !== 'transparent'));
      if (rect.width >= limits.largeSvgMinPx && rect.height >= limits.largeSvgMinPx && primitives >= limits.largeSvgMinPrimitives && fills.size >= limits.largeSvgMinFills && element.querySelectorAll('text,tspan').length <= limits.largeSvgMaxText && !element.querySelector('pattern')) unknown('SLOP-051', `assembled SVG candidate at ${selectorFor(element)} needs illustration-versus-data judgment`);
    }
    if (style.clipPath.startsWith('polygon(')) {
      const points = style.clipPath.slice(8, -1).split(',');
      const values = points.flatMap((point) => [...point.matchAll(/(-?[\d.]+)%/g)].map((match) => Number(match[1])));
      const off = values.filter((value) => Math.abs(value / limits.maskGridPercent - Math.round(value / limits.maskGridPercent)) * limits.maskGridPercent > limits.maskOffGridTolerance).length;
      if (points.length >= limits.maskMinVertices && values.length && off >= values.length / 2) add('SLOP-052', 'LOW', element, { vertices: points.length, offGrid: off }, `>=${limits.maskMinVertices} vertices; >=50% off-grid`);
    } else if (style.clipPath.startsWith('path(') && (style.clipPath.match(/[CSQTAcsqta](?=[\s\d-])/g)?.length ?? 0) >= limits.maskMinCurves) add('SLOP-052', 'LOW', element, style.clipPath, `>=${limits.maskMinCurves} curves`);
    const layoutMotion = style.transitionProperty.split(',').map((part) => part.trim()).filter((part) => /^(width|height|max-height|padding(?:-.+)?|margin(?:-.+)?|top|left)$/.test(part));
    if (layoutMotion.length && !element.closest('details,[aria-expanded],.accordion,.collapse') && !element.querySelector('[aria-expanded]')) add('CF-508', 'MEDIUM', element, layoutMotion, 'transform|opacity', 'measured', 'SLOP-026 cross-reference');
    if ((style.backgroundClip === 'text' || style.webkitBackgroundClip === 'text') && /gradient\(/.test(style.backgroundImage)) add('SLOP-009', 'MEDIUM', element, style.backgroundImage.slice(0, 80), 'solid ink');
    if (ownText && (element.matches('h1,h2,h3') || fontSize >= 20)) {
      const ink = parseRgb(style.color);
      if (ink) {
        const [hue] = hueAndSaturation(ink);
        if (hue >= limits.accentPurpleHueMin && hue <= limits.accentPurpleHueMax && Math.max(...ink) - Math.min(...ink) >= limits.accentPurpleChannelSpread) add('SLOP-008', 'MEDIUM', element, style.color, `${limits.accentPurpleHueMin}–${limits.accentPurpleHueMax}°`, 'derived', 'verify whether this is the declared primary brand hue');
      }
    }
    if (/gradient\(/.test(style.backgroundImage) && /rgb\(/.test(style.backgroundImage)) {
      const stops = [...style.backgroundImage.matchAll(/rgb\([^)]*\)/g)].map((match) => parseRgb(match[0])).filter(Boolean);
      if (stops.length >= 2 && stops.every((stop) => { const [hue] = hueAndSaturation(stop); return hue >= limits.accentPurpleHueMin && hue <= limits.accentPurpleHueMax && Math.max(...stop) - Math.min(...stop) >= limits.accentPurpleChannelSpread; })) add('SLOP-008', 'MEDIUM', element, style.backgroundImage.slice(0, 80), 'brand-led palette', 'derived');
    }
    if (/\bblur\(/.test(style.backdropFilter) && element.matches('dialog,[role="dialog"],.modal,.scrim,.backdrop')) add('CF-406', 'LOW', element, style.backdropFilter, 'solid scrim');
    if (element.matches('button,.primary,.btn-primary,[data-primary],h1,h2') && style.boxShadow !== 'none') {
      const shadowColor = parseRgb(style.boxShadow);
      const lengths = [...style.boxShadow.matchAll(/(-?[\d.]+)px/g)].map((match) => Number(match[1]));
      if (shadowColor && lengths.length >= 3 && Math.abs(lengths[0]) <= 2 && Math.abs(lengths[1]) <= 2 && lengths[2] >= limits.glowBlurPx && hueAndSaturation(shadowColor)[1] > limits.glowSaturationMin) glows.push(element);
    }
    if (element.matches('section,article,div') && Number.parseFloat(style.borderRadius) > 0 && !element.closest('[role="alert"],[role="note"],[role="status"],.callout,.admonition')) {
      const sides = ['Top', 'Right', 'Bottom', 'Left'];
      const accented = sides.filter((side) => {
        const thickness = Number.parseFloat(style[`border${side}Width`]);
        const color = parseRgb(style[`border${side}Color`]);
        return thickness >= 2 && color && hueAndSaturation(color)[1] > 0.3;
      });
      if (accented.length === 1 && sides.filter((side) => side !== accented[0]).every((side) => Number.parseFloat(style[`border${side}Width`]) <= 1)) stripeScopes.push(element);
    }
    if (element.matches('main,body') && ['rgb(0, 0, 0)', 'rgb(255, 255, 255)'].includes(style.backgroundColor)) add('SLOP-023', 'LOW', element, style.backgroundColor, 'theme-specific ground', 'derived');
    if (style.willChange !== 'auto') {
      const properties = style.willChange.split(',').map((part) => part.trim());
      const wrong = properties.filter((part) => !['transform', 'opacity', 'filter'].includes(part));
      if (wrong.length) add('CF-507', 'LOW', element, wrong.join(','), 'transform|opacity|filter');
      else if (!element.getAnimations().some((animation) => animation.playState === 'running')) add('CF-507', 'MEDIUM', element, style.willChange, 'only during animation');
    }
    if (rect.width >= limits.accentMinSidePx && rect.height >= limits.accentMinSidePx && element.matches('.primary,.btn-primary,[data-primary],[aria-current],.active,[data-accent]')) {
      const fill = parseRgb(style.backgroundColor);
      if (fill) {
        const hi = Math.max(...fill), lo = Math.min(...fill), delta = hi - lo;
        if (hi && delta / hi >= limits.accentSaturationMin) {
          let hue = hi === fill[0] ? ((fill[1] - fill[2]) / delta) % 6 : hi === fill[1] ? (fill[2] - fill[0]) / delta + 2 : (fill[0] - fill[1]) / delta + 4;
          hue = (hue * 60 + 360) % 360;
          if (!accents.some((candidate) => Math.min(Math.abs(candidate - hue), 360 - Math.abs(candidate - hue)) <= limits.accentHueMergeDeg)) accents.push(hue);
        }
      }
    }
    if (element.matches('a[href="#"],a[href^="javascript:"]')) add('SLOP-058', element.closest('main,nav,header') ? 'HIGH' : 'MEDIUM', element, element.getAttribute('href'), 'working destination', 'derived');
    if (style.animationName !== 'none' && element.getAnimations().some((animation) => animation.playState === 'running') && style.transform.startsWith('matrix(')) {
      const matrix = style.transform.slice(7, -1).split(',').map(Number);
      const scale = Math.min(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]));
      if (scale < limits.entranceScaleMin) add('CF-503', 'MEDIUM', element, Number(scale.toFixed(2)), limits.entranceScaleMin);
    }
  }
  if (accents.length > limits.accentFamilyMax) add('CF-205', 'MEDIUM', null, accents.length, limits.accentFamilyMax, 'derived');
  if (fonts.size > limits.typeFamilyMax) add('SLOP-019', 'MEDIUM', null, fonts.size, limits.typeFamilyMax);
  if (typeRoles.size > 7) add('CF-108', 'MEDIUM', null, typeRoles.size, 7, 'derived');
  for (const heading of headings.filter((element) => element.matches('h2,h3,h4'))) {
    const rect = heading.getBoundingClientRect();
    let anchor = heading;
    let previous = null;
    while (anchor && anchor !== document.body) {
      const prior = anchor.previousElementSibling;
      if (prior) { previous = prior; break; }
      anchor = anchor.parentElement;
      if (!anchor || anchor === document.body) break;
      const boundary = getComputedStyle(anchor);
      if (!['rgba(0, 0, 0, 0)', 'transparent'].includes(boundary.backgroundColor) || Number.parseFloat(boundary.borderTopWidth) > 0 || boundary.boxShadow !== 'none') break;
    }
    const next = heading.nextElementSibling;
    if (!previous || !next) continue;
    const beforeRect = previous.getBoundingClientRect();
    const afterRect = next.getBoundingClientRect();
    if (beforeRect.right <= rect.left || beforeRect.left >= rect.right || beforeRect.height === 0 || afterRect.height === 0) continue;
    let headingTop = rect.top;
    if (beforeRect.height <= limits.headingLabelMaxHeightPx && rect.top - beforeRect.bottom < limits.headingLabelGapPx) {
      const earlier = previous.previousElementSibling;
      if (earlier) { headingTop = beforeRect.top; previous = earlier; }
    }
    const above = Math.max(0, headingTop - previous.getBoundingClientRect().bottom);
    const below = Math.max(0, afterRect.top - rect.bottom);
    if (above < below * limits.headingInversionRatio && below - above >= limits.headingInversionDeficitPx) add('CF-304', 'LOW', heading, { above, below }, `above >= ${limits.headingInversionRatio}x below or deficit < ${limits.headingInversionDeficitPx}px`);
  }
  for (const child of [...document.querySelectorAll('body *')].slice(0, limits.elementCap)) {
    const parent = child.parentElement;
    if (!parent || parent === document.body) continue;
    const outer = getComputedStyle(parent), inner = getComputedStyle(child);
    const pads = ['Top', 'Right', 'Bottom', 'Left'].map((side) => Number.parseFloat(outer[`padding${side}`]));
    if (pads.some((pad) => !Number.isFinite(pad) || pad > limits.framePaddingMaxPx)) continue;
    const parentRect = parent.getBoundingClientRect(), childRect = child.getBoundingClientRect();
    if (!parentRect.width || !parentRect.height || !childRect.width || !childRect.height) continue;
    const insets = [childRect.top-parentRect.top, parentRect.right-childRect.right, parentRect.bottom-childRect.bottom, childRect.left-parentRect.left];
    if (insets.some((inset, index) => Math.abs(inset - pads[index]) > limits.frameContentTolerancePx)) continue;
    for (const [corner, pad] of [['TopLeft', (pads[0]+pads[3])/2], ['TopRight', (pads[0]+pads[1])/2], ['BottomRight', (pads[2]+pads[1])/2], ['BottomLeft', (pads[2]+pads[3])/2]]) {
      const outerRadius = Math.min(Number.parseFloat(outer[`border${corner}Radius`]), Math.min(parentRect.width,parentRect.height)/2);
      const innerRadius = Math.min(Number.parseFloat(inner[`border${corner}Radius`]), Math.min(childRect.width,childRect.height)/2);
      if (outerRadius > 0 && Math.abs(innerRadius - Math.max(0,outerRadius-pad)) > limits.concentricTolerancePx) add('CF-401', 'LOW', child, { corner, outerRadius, innerRadius, pad }, limits.concentricTolerancePx);
    }
  }
  const cadence = document.body.innerText ?? '';
  const firstShape = [...cadence.matchAll(/Not an?\s+[a-z][^.!]{1,40}[.!]\s+[A-Z][^.!]{1,60}[.!]/g)].length;
  const secondShape = [...cadence.matchAll(/[A-Z][^.!]{4,80}[.!]\s+(?:No|Just)\s+[a-z][^.!]{2,60}[.!]/g)].length;
  if (firstShape + secondShape >= limits.cadenceMinPairs) add('SLOP-039', 'LOW', document.body, firstShape + secondShape, limits.cadenceMinPairs);
  const offScale = [...spacingValues].filter((value) => value >= limits.spacingGridPx && Math.abs(value - Math.round(value / limits.spacingGridPx) * limits.spacingGridPx) > limits.spacingTolerancePx);
  if (offScale.length) add('CF-301', offScale.length > limits.offScaleMediumCount ? 'MEDIUM' : 'LOW', null, offScale, `${limits.spacingGridPx}px grid ±${limits.spacingTolerancePx}px`, 'derived');
  if (glows.length >= limits.repeatingGlowCount) for (const element of glows) add('SLOP-010', 'MEDIUM', element, getComputedStyle(element).boxShadow, `recurrence >= ${limits.repeatingGlowCount}`);
  if (gridCandidates.length && findings.some((finding) => ['SLOP-008','SLOP-010'].includes(finding.rule))) for (const element of gridCandidates) add('SLOP-012', 'MEDIUM', element, getComputedStyle(element).backgroundImage.slice(0,80), 'grid plus decorative signal');
  if (numericLabels.size >= 2) unknown('SLOP-030', `${numericLabels.size} numbered sections need process-order review`);
  if (stripeScopes.length >= limits.stripeRepeatCount) add('SLOP-015', 'MEDIUM', stripeScopes[0], stripeScopes.length, limits.stripeRepeatCount, 'derived');
  const sectionHeadings = headings.filter((element) => element.matches('h2'));
  const sectionEyebrows = sectionHeadings.map((heading) => heading.previousElementSibling).filter((candidate) => candidate && eyebrowCandidates.includes(candidate));
  if (sectionHeadings.length && sectionEyebrows.length > Math.ceil(sectionHeadings.length * limits.sectionEyebrowFraction)) add('SLOP-029', 'MEDIUM', sectionEyebrows[0], sectionEyebrows.length, Math.ceil(sectionHeadings.length * limits.sectionEyebrowFraction), 'derived');
  for (let first = 0; first < Math.min(textBoxes.length, 200); first++) for (let second = first + 1; second < Math.min(textBoxes.length, 200); second++) {
    const left = textBoxes[first], right = textBoxes[second];
    if (left.element.contains(right.element) || right.element.contains(left.element)) continue;
    const x = Math.max(0, Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left));
    const y = Math.max(0, Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top));
    const fraction = x * y / Math.min(left.rect.width * left.rect.height, right.rect.width * right.rect.height);
    if (fraction >= limits.overlapFraction) add('RS-007', 'MEDIUM', right.element, Number(fraction.toFixed(2)), limits.overlapFraction, 'measured', `overlaps ${selectorFor(left.element)}`);
  }
  for (let first = 0; first < Math.min(controls.length, 150); first++) for (let second = first + 1; second < Math.min(controls.length, 150); second++) {
    const a = controls[first], b = controls[second];
    if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
    const x = Math.max(0, Math.max(a.rect.left - b.rect.right, b.rect.left - a.rect.right));
    const y = Math.max(0, Math.max(a.rect.top - b.rect.bottom, b.rect.top - a.rect.bottom));
    const gap = Math.hypot(x, y);
    const floor = viewport.width <= limits.touchPrimaryMaxWidthPx ? limits.neighborCoarseClearancePx : limits.neighborFineClearancePx;
    if (gap < floor) add('CF-702', 'MEDIUM', b.element, Number(gap.toFixed(1)), floor, 'measured', `near ${selectorFor(a.element)}`);
  }
  if (viewport.id === '390') {
    const prior = document.activeElement;
    for (const { element } of controls.slice(0, 5)) {
      const before = getComputedStyle(element);
      const initial = [before.outlineStyle, before.outlineWidth, before.outlineColor, before.boxShadow, before.borderColor].join('|');
      element.focus({ preventScroll: true });
      const after = getComputedStyle(element);
      const focused = [after.outlineStyle, after.outlineWidth, after.outlineColor, after.boxShadow, after.borderColor].join('|');
      if (document.activeElement !== element) { unknown('CF-202', `focus could not be applied at ${selectorFor(element)}`); continue; }
      if (focused === initial) add('CF-202', 'HIGH', element, 'no focus-state change', 'visible focus indicator');
      else if (after.outlineStyle !== 'auto' && after.outlineStyle !== 'none' && Number.parseFloat(after.outlineWidth) < 2) add('CF-202', 'MEDIUM', element, focused, '2px custom ring or browser auto outline', 'derived');
      element.blur();
    }
    if (prior && prior !== document.body && typeof prior.focus === 'function') prior.focus({ preventScroll: true });
  }
  if (viewport.id === '390-dark') {
    const rootBackground = background(document.body);
    if (rootBackground && luminance(rootBackground) >= limits.darkGroundLuminanceMax) {
      const toggle = document.querySelector('[aria-label*="theme" i],[aria-label*="dark" i],[data-theme-toggle],[role="switch"][aria-label*="mode" i]');
      if (toggle) unknown('RS-002', 'theme control found; toggle-only dark path cannot be activated by the probe');
      else add('RS-002', 'MEDIUM', document.body, Number(luminance(rootBackground).toFixed(2)), limits.darkGroundLuminanceMax);
    }
  }
  if (viewport.reducedMotion) {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) add('RS-003', 'HIGH', null, false, true);
    for (const video of document.querySelectorAll('video')) if (!video.paused) add('RS-003', 'HIGH', video, 'playing', 'paused');
    for (const element of document.querySelectorAll('body *')) for (const animation of element.getAnimations()) {
      const timing = animation.effect?.getTiming();
      if (animation.playState !== 'running' || (timing?.duration ?? 0) <= limits.reducedMotionMaxMs || element.closest('[role="progressbar"],[role="status"],[aria-live]')) continue;
      const keys = animation.effect?.getKeyframes() ?? [];
      const motion = keys.some((key) => ['transform', 'translate', 'rotate', 'scale', 'left', 'top', 'right', 'bottom', 'width', 'height', 'margin', 'padding'].some((prop) => prop in key));
      if (motion) add('RS-003', 'HIGH', element, timing.duration, limits.reducedMotionMaxMs);
    }
  }
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (rule.type === CSSRule.KEYFRAMES_RULE) {
        const starts = [...rule.cssRules].filter((frame) => /(?:^|,)\s*(?:from|0%)\s*(?:,|$)/.test(frame.keyText));
        const scales = starts.flatMap((frame) => [...frame.style.transform.matchAll(/scale(?:X|Y)?\(\s*([\d.]+)/g)].map((match) => Number(match[1])));
        if (scales.some((scale) => scale < limits.entranceScaleMin)) add('CF-503', 'LOW', null, Math.min(...scales), limits.entranceScaleMin, 'derived', `declared keyframe ${rule.name}; execution not confirmed`);
      }
    }
  }
  return { findings, notVerified, readyState: document.readyState, width, scrollWidth: document.documentElement.scrollWidth };
}
