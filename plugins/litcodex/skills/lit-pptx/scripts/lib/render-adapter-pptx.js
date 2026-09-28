"use strict";

/**
 * render-adapter-pptx.js — Render a resolved slide spec to a PPTX file.
 *
 * Architecture: Each text line is its own separate shape (individual addText()
 * call). Bullet items use manual "•  " prefix in green (#00AE41) Bold 16pt.
 * Section headers are separate shapes in Bold 18pt black.
 *
 * Input: resolved spec from layout-resolver, templateObj from registry, output path.
 * Output: writes a .pptx file via pptxgenjs.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
const { extractContent, looksLikeKpi } = require("./layout-resolver");

// Narrowest a KPI badge can be and still read as one glance.
const KPI_MIN_CARD_WIDTH_IN = 1.9;

const TOOLKIT_ROOT = path.resolve(__dirname, "../..");
const ASSETS_MEDIA = path.join(TOOLKIT_ROOT, "assets", "media");
const ASSETS_AZURE = path.join(TOOLKIT_ROOT, "assets", "azure");

/** Resolve a decoration asset path: explicit absolute override (custom-accent
 * regenerated gradients), then d.dir "azure" → assets/azure, else assets/media. */
function decorAssetPath(d) {
  if (d.assetPath) return d.assetPath;
  if (d.dir === "azure") return path.join(ASSETS_AZURE, d.asset);
  return path.join(ASSETS_MEDIA, d.asset);
}
const hex = (c) => (c || "#000000").replace("#", "");

function linkedTableCell(text, options) {
  const original = cleanMd(text);
  let display = original;
  let url = null;
  const markdown = original.match(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/i);
  if (markdown) {
    display = original.replace(markdown[0], markdown[1]);
    url = markdown[2];
  } else {
    const rawUrl = original.match(/https?:\/\/[^\s<>\])}]+/i);
    const doi = original.match(/\b10\.\d{4,9}\/[^\s<>\])}]+/i);
    if (rawUrl) url = rawUrl[0].replace(/[.,;:]+$/, "");
    else if (doi) url = `https://doi.org/${doi[0].replace(/[.,;:]+$/, "")}`;
  }
  return {
    text: display,
    options: {
      ...options,
      ...(url ? { hyperlink: { url } } : {}),
    },
  };
}

// ── Text style constants (template-derived with neutral fallbacks).
// These are reassigned from the template at the start of render() so the same
// adapter serves any enrolled template (e.g. BOILERPLATE-PRETENDARD).
let FONT_BOLD = "Pretendard";
let FONT_MEDIUM = "Pretendard";
let FONT_LIGHT = "Pretendard";
let CHAR_SPACING = -0.7;

function expandHome(p) {
  if (p === "~") return os.homedir();
  if (p && p.startsWith(`~${path.sep}`)) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolveImagePath(src, sourceDir) {
  if (!src) throw new Error("Image source is empty");
  const expanded = expandHome(src);
  const candidates = [];
  if (path.isAbsolute(expanded)) candidates.push(expanded);
  else {
    if (sourceDir) candidates.push(path.resolve(sourceDir, expanded));
    candidates.push(path.resolve(process.cwd(), expanded));
    candidates.push(path.join(ASSETS_MEDIA, expanded));
    candidates.push(path.resolve(TOOLKIT_ROOT, expanded));
  }
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Image not found: ${src}. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

function readImageSize(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length >= 24 && buf.toString("ascii", 1, 4) === "PNG") {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) { offset++; continue; }
      const marker = buf[offset + 1];
      const length = buf.readUInt16BE(offset + 2);
      if (length < 2) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

function containBox(x, y, w, h, imageSize) {
  if (!imageSize || !imageSize.width || !imageSize.height) return { x, y, w, h };
  const boxRatio = w / h;
  const imageRatio = imageSize.width / imageSize.height;
  if (imageRatio > boxRatio) {
    const fittedH = w / imageRatio;
    return { x, y: y + (h - fittedH) / 2, w, h: fittedH };
  }
  const fittedW = h * imageRatio;
  return { x: x + (w - fittedW) / 2, y, w: fittedW, h };
}

// Bullet items
let BULLET_FONT = FONT_BOLD;
const BULLET_SIZE = 16;
let BULLET_COLOR = "334155"; // neutral fallback, reassigned per-template
let SECTION_ACCENT = "334155"; // neutral fallback, reassigned per-template
const BULLET_PREFIX = "\u2022  "; // "•  " (bullet + two spaces)
const BULLET_X = 0.59;
const BULLET_W = 8.8;
const BULLET_H = 0.38;
const BULLET_Y_SPACING = 0.42;
const BULLET_LINE_SPACING = 1.25;

// Section headers
let SEC_HEADER_FONT = FONT_BOLD;
const SEC_HEADER_SIZE = 18;
const SEC_HEADER_COLOR = "000000";
const SEC_HEADER_X = 0.39;
const SEC_HEADER_W = 9.0;
const SEC_HEADER_H = 0.5;

// Summary (narrow width)
const SUMMARY_HEADER_W = 4.3;
const SUMMARY_BULLET_W = 4.8;
const SUMMARY_BULLET_SIZE = 14;
const SUMMARY_BULLET_H = 0.34;
const SUMMARY_BULLET_Y_SPACING = 0.38;
const SUMMARY_BULLET_LINE_SPACING = 1.05;

// TOC items (separate shapes)
let TOC_FONT = FONT_BOLD;
const TOC_SIZE = 18;
const TOC_COLOR = "000000";
const TOC_X = 0.390;
const TOC_W = 7.500;
const TOC_H = 0.550;
const TOC_Y_START = 0.957;
const TOC_Y_SPACING = 0.650;

function weightedTextLength(text) {
  let total = 0;
  for (const ch of String(text || "")) {
    if (/\s/.test(ch)) total += 0.35;
    else if (/^[\x00-\x7F]$/.test(ch)) total += 0.58;
    else total += 1.0;
  }
  return total;
}

function estimateWrappedLines(text, widthIn, fontSize) {
  const usablePt = Math.max(12, (widthIn || 4) * 72 - 10);
  // Conservative on purpose: PowerPoint wraps dense mixed
  // Korean-English strings earlier than a naive ASCII width estimate.
  const unitsPerLine = Math.max(4, usablePt / Math.max(4, fontSize * 0.95));
  return Math.max(1, Math.ceil(weightedTextLength(text) / unitsPerLine));
}

function estimateTextHeight(text, widthIn, fontSize, lineSpacingMultiple) {
  const lines = estimateWrappedLines(text, widthIn, fontSize);
  return Math.max(0.14, ((lines * fontSize * lineSpacingMultiple) / 72) * 1.4 + 0.08);
}

function bodyElements(items) {
  const elements = [];
  let numberedCounter = 0;
  for (const item of items) {
    if (item.type === "section") {
      elements.push({ kind: "section", text: item.heading || "" });
      numberedCounter = 0;
      for (const child of item.children || []) {
        numberedCounter++;
        elements.push({ kind: "numbered", text: `(${numberedCounter})  ${child.text || ""}` });
      }
    } else if (item.type === "bullet") {
      elements.push({ kind: "bullet", text: item.text || "" });
      numberedCounter = 0;
      for (const child of item.children || []) {
        numberedCounter++;
        elements.push({ kind: "numbered", text: `(${numberedCounter})  ${child.text || ""}` });
      }
    } else if (item.type === "numbered") {
      numberedCounter++;
      elements.push({ kind: "numbered", text: `(${numberedCounter})  ${item.text || ""}` });
    } else if (item.type === "text") {
      elements.push({ kind: "text", text: item.text || "" });
    }
  }
  return elements;
}

function chooseBodyStyle(items, widthIn, startY, bottomY) {
  const available = Math.max(0.5, (bottomY || 7.0) - startY);
  const sizes = [16, 15, 14, 13];
  for (const bodySize of sizes) {
    const sectionSize = Math.min(18, bodySize + 2);
    const lineSpacing = bodySize <= 10 ? 1.05 : 1.18;
    const gap = bodySize <= 10 ? 0.035 : 0.05;
    const total = bodyElements(items).reduce((sum, el) => {
      const size = el.kind === "section" ? sectionSize : bodySize;
      const w = el.kind === "section" ? Math.min(widthIn, SEC_HEADER_W) : widthIn;
      return sum + estimateTextHeight(el.text, w, size, lineSpacing) + gap;
    }, 0);
    if (total <= available) return { bodySize, sectionSize, lineSpacing, gap };
  }
  return { bodySize: 13, sectionSize: 15, lineSpacing: 1.08, gap: 0.04 };
}

function estimateSectionHeight(item, secW, bulletW, style) {
  let total = estimateTextHeight(item.heading || "", secW, style.sectionSize, style.lineSpacing) + style.gap;
  let numberedCounter = 0;
  for (const child of item.children || []) {
    numberedCounter++;
    total += estimateTextHeight(`(${numberedCounter})  ${child.text || ""}`, bulletW, style.bodySize, style.lineSpacing) + style.gap;
  }
  return total + 0.12;
}

function addSectionCard(slide, x, y, w, h) {
  slide.addShape("rect", {
    x,
    y: y - 0.035,
    w,
    h: Math.max(0.28, h),
    fill: { color: "F7F9F8", transparency: 12 },
    line: { color: "D8E2DD", width: 0.5, transparency: 20 },
  });
}

function bodyItemsToDiagnosticLines(items) {
  const lines = [];
  let numberedCounter = 0;
  for (const item of items || []) {
    if (item.type === "section") {
      lines.push(`■ ${item.heading || ""}`);
      numberedCounter = 0;
      for (const child of item.children || []) {
        numberedCounter++;
        lines.push(`(${numberedCounter}) ${child.text || ""}`);
      }
    } else if (item.type === "bullet") {
      lines.push(`• ${item.text || ""}`);
      numberedCounter = 0;
      for (const child of item.children || []) {
        numberedCounter++;
        lines.push(`(${numberedCounter}) ${child.text || ""}`);
      }
    } else if (item.type === "numbered") {
      numberedCounter++;
      lines.push(`(${numberedCounter}) ${item.text || ""}`);
    } else if (item.type === "text") {
      lines.push(item.text || "");
    }
  }
  return lines.filter(Boolean);
}

function bodyItemsToDiagnosticCards(items) {
  const cards = [];
  let numberedCounter = 0;
  for (const item of items || []) {
    if (item.type === "section" || item.type === "bullet") {
      const title = item.heading || item.text || "";
      const body = [];
      numberedCounter = 0;
      for (const child of item.children || []) {
        numberedCounter++;
        body.push(`(${numberedCounter}) ${child.text || ""}`);
      }
      if (title || body.length) cards.push({ title, body });
    } else if (item.type === "numbered") {
      numberedCounter++;
      cards.push({ title: `(${numberedCounter})`, body: [item.text || ""] });
    } else if (item.type === "text" && item.text) {
      cards.push({ title: "", body: [item.text] });
    }
  }
  return cards;
}

function splitLinesByWeight(lines, columns) {
  const groups = Array.from({ length: columns }, () => []);
  const weights = Array(columns).fill(0);
  for (const line of lines) {
    let target = 0;
    for (let i = 1; i < columns; i++) {
      if (weights[i] < weights[target]) target = i;
    }
    groups[target].push(line);
    weights[target] += Math.max(20, weightedTextLength(line));
  }
  return groups;
}

function splitCardsByWeight(cards, columns) {
  const groups = Array.from({ length: columns }, () => []);
  const weights = Array(columns).fill(0);
  for (const card of cards) {
    let target = 0;
    for (let i = 1; i < columns; i++) {
      if (weights[i] < weights[target]) target = i;
    }
    groups[target].push(card);
    const cardWeight = weightedTextLength(card.title || "") * 1.4
      + (card.body || []).reduce((sum, line) => sum + weightedTextLength(line), 0);
    weights[target] += Math.max(80, cardWeight);
  }
  return groups;
}

function renderDiagnosticCard(slide, card, x, y, w, h, idx) {
  slide.addShape("rect", {
    x,
    y,
    w,
    h,
    fill: { color: idx % 2 ? "F8FAF9" : "F3F6F4", transparency: 2 },
    line: { color: "D6E2DB", width: 0.35, transparency: 12 },
  });
  slide.addShape("rect", {
    x,
    y,
    w: 0.028,
    h,
    fill: { color: SECTION_ACCENT, transparency: 0 },
    line: { color: SECTION_ACCENT, transparency: 100 },
  });

  const padX = 0.055;
  const padY = 0.05;
  const titleH = card.title ? Math.min(0.28, Math.max(0.18, h * 0.16)) : 0;
  if (card.title) {
    slide.addText(card.title, {
      x: x + padX,
      y: y + padY,
      w: w - padX * 1.45,
      h: titleH,
      fontFace: FONT_BOLD,
      fontSize: 7.4,
      color: "002554",
      charSpacing: -0.25,
      fit: "shrink",
      margin: 0.01,
      breakLine: false,
      valign: "top",
    });
  }

  const bodyText = (card.body || []).join("\n");
  if (bodyText) {
    slide.addText(bodyText, {
      x: x + padX,
      y: y + padY + titleH + 0.015,
      w: w - padX * 1.45,
      h: Math.max(0.16, h - titleH - padY * 1.6),
      fontFace: FONT_MEDIUM,
      fontSize: 5.85,
      color: "1F1F1F",
      charSpacing: -0.18,
      fit: "shrink",
      margin: 0.008,
      paraSpaceAfterPt: 0,
      lineSpacingMultiple: 0.96,
      breakLine: false,
      valign: "top",
    });
  }
}

function estimateDiagnosticCardHeight(card, w) {
  const padY = 0.05;
  const titleH = card.title ? 0.24 : 0;
  const bodyText = (card.body || []).join("\n");
  const bodyH = bodyText ? estimateTextHeight(bodyText, Math.max(0.8, w - 0.12), 5.85, 1.02) : 0;
  return Math.max(0.56, Math.min(2.35, padY * 2 + titleH + bodyH));
}

function renderCramStressBody(slide, items, pageW, pageH) {
  const cards = bodyItemsToDiagnosticCards(items);
  const columns = 3;
  const groups = cards.length ? splitCardsByWeight(cards, columns) : splitLinesByWeight(bodyItemsToDiagnosticLines(items), columns).map((group) => [{ title: "", body: group }]);
  const x = 0.28;
  const y = 0.98;
  const w = 7.78;
  const h = pageH - y - 0.34;
  const gap = 0.105;
  const colW = (w - gap * (columns - 1)) / columns;
  groups.forEach((group, idx) => {
    const colX = x + idx * (colW + gap);
    const cardGap = 0.075;
    const availableH = h - cardGap * Math.max(0, group.length - 1);
    const desiredHeights = group.map((card) => estimateDiagnosticCardHeight(card, colW));
    const desiredTotal = desiredHeights.reduce((sum, value) => sum + value, 0) || 1;
    const scale = desiredTotal > availableH ? availableH / desiredTotal : 1;
    let cursorY = y;
    group.forEach((card, cardIdx) => {
      const remainingCards = group.length - cardIdx - 1;
      const rawH = desiredHeights[cardIdx] * scale;
      const cardH = Math.max(0.62, Math.min(rawH, h - (cursorY - y) - remainingCards * (0.62 + cardGap)));
      renderDiagnosticCard(slide, card, colX, cursorY, colW, cardH, idx + cardIdx);
      cursorY += cardH + cardGap;
    });
  });
}

function renderCramStressImageSheet(slide, content, sourceDir, pageW, pageH) {
  if (!content) return;
  const images = content.type === "image-grid"
    ? (Array.isArray(content.images) ? content.images : [])
    : content.type === "image" ? [content] : [];
  if (images.length === 0) return;
  const x = 8.24;
  const y = 0.98;
  const w = pageW - x - 0.25;
  const h = pageH - y - 0.34;
  const cols = images.length >= 8 ? 2 : 1;
  const rows = Math.ceil(images.length / cols);
  const gap = 0.04;
  const cellW = (w - gap * (cols - 1)) / cols;
  const headerH = 0.28;
  const sheetH = Math.min(h - 0.9, rows * 0.58 + gap * (rows - 1));
  const cellH = (sheetH - gap * (rows - 1)) / rows;
  const noteY = y + headerH + sheetH + 0.16;
  const noteH = Math.min(1.0, h - (noteY - y) - 0.08);
  const panelH = noteY - y + noteH;
  slide.addShape("rect", {
    x: x - 0.04,
    y: y - 0.04,
    w: w + 0.08,
    h: panelH + 0.08,
    fill: { color: "F5F8F6", transparency: 0 },
    line: { color: "CAD4CE", width: 0.5 },
  });
  slide.addText("RAW EVIDENCE CONTACT SHEET", {
    x,
    y: y + 0.02,
    w,
    h: 0.16,
    fontFace: FONT_BOLD,
    fontSize: 5.8,
    color: "002554",
    charSpacing: -0.15,
    fit: "shrink",
    margin: 0,
  });
  slide.addShape("rect", {
    x,
    y: y + 0.22,
    w,
    h: 0,
    line: { color: SECTION_ACCENT, width: 0.45 },
  });
  images.forEach((image, idx) => {
    const imgPath = resolveImagePath(image.src, sourceDir);
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const fit = containBox(
      x + col * (cellW + gap),
      y + headerH + row * (cellH + gap),
      cellW,
      cellH,
      readImageSize(imgPath),
    );
    slide.addImage({
      path: imgPath,
      ...fit,
      altText: image.caption || path.basename(image.src || imgPath),
    });
  });
  slide.addShape("rect", {
    x,
    y: noteY,
    w,
    h: noteH,
    fill: { color: "FFFFFF", transparency: 0 },
    line: { color: "D6E2DB", width: 0.35, transparency: 20 },
  });
  slide.addText("diagnostic cram-stress\nmicrotext is intentional\nproduction decks must synthesize\noverflow / marker / missing media = fail", {
    x: x + 0.06,
    y: noteY + 0.07,
    w: w - 0.12,
    h: Math.max(0.24, noteH - 0.14),
    fontFace: FONT_MEDIUM,
    fontSize: 5.3,
    color: "333333",
    charSpacing: -0.15,
    fit: "shrink",
    margin: 0.01,
    breakLine: false,
    lineSpacingMultiple: 1.02,
    valign: "mid",
  });
}

function isCramStressDeck(resolved) {
  const meta = (resolved && resolved.deck && resolved.deck.metadata) || {};
  return String(meta.render_mode || meta.renderMode || "").toLowerCase() === "cram-stress";
}

function renderCramStressSlide(slide, slideSpec, pageW, pageH, sourceDir) {
  const regions = slideSpec.regions || {};
  const title = regions.title && regions.title.content;
  if (title) {
    slide.addText(String(title), {
      x: 0.24,
      y: 0.24,
      w: pageW - 1.72,
      h: 0.46,
      fontFace: FONT_BOLD,
      fontSize: 13.5,
      color: "000000",
      charSpacing: CHAR_SPACING,
      fit: "shrink",
    });
    slide.addShape("rect", {
      x: 0.24,
      y: 0.76,
      w: pageW - 0.48,
      h: 0,
      line: { color: SECTION_ACCENT, width: 1.2 },
    });
  }
  if (regions.body && regions.body.content && regions.body.content.type === "body") {
    renderCramStressBody(slide, regions.body.content.items || [], pageW, pageH);
  }
  if (regions.image && regions.image.content) {
    renderCramStressImageSheet(slide, regions.image.content, sourceDir, pageW, pageH);
  }
}

function shouldUseDenseBodyFlow(items, widthIn, startY, bottomY) {
  const elements = bodyElements(items);
  const charCount = elements.reduce((sum, el) => sum + String(el.text || "").length, 0);
  const available = Math.max(0.5, (bottomY || 7.0) - startY);
  const estimatedAtMin = elements.reduce((sum, el) => {
    const size = el.kind === "section" ? 12.8 : 11.5;
    return sum + estimateTextHeight(el.text, Math.max(1.8, widthIn / 2), size, 1.02) + 0.025;
  }, 0);
  return widthIn >= 4.4 && (elements.length >= 18 || charCount >= 2400 || estimatedAtMin > available * 1.35);
}

function chooseDenseBodyStyle() {
  return { bodySize: 11.5, sectionSize: 12.8, lineSpacing: 1.02, gap: 0.025 };
}

// ── Font role helpers ───────────────────────────────────────────────────────

/**
 * Build font role map from template capabilities.
 * Maps YAML field names to pptxgenjs option names.
 */
function buildFontRoles(templateObj) {
  if (!templateObj || !templateObj.capabilities || !templateObj.capabilities.font_roles) {
    return {};
  }

  const roles = {};
  for (const [name, def] of Object.entries(templateObj.capabilities.font_roles)) {
    roles[name] = {
      font: def.font,
      size: def.size,
      color: (def.color || "#000000").replace("#", ""),
      align: def.align || "left",
      charSpacing: def.char_spacing,
      lineSpacing: def.line_spacing,
      bold: def.bold,
      spaceAfter: def.space_after,
      bulletType: def.bullet_type,
      bulletChar: def.bullet_char,
      bulletFont: def.bullet_font,
      numberType: def.number_type,
      marL: def.marL,
      indent: def.indent,
      fill: def.fill ? def.fill.replace("#", "") : undefined,
      borderColor: def.border_color ? def.border_color.replace("#", "") : undefined,
      borderWidth: def.border_width,
    };
  }
  return roles;
}

// ── Decoration rendering ────────────────────────────────────────────────────

/**
 * Add decoration elements to a pptxgenjs slide.
 * Note: slide_number is intentionally omitted — the reference template has none.
 */
function addDecorations(slide, decorations, slideIdx, fontRoles) {
  if (!decorations || !Array.isArray(decorations)) return;

  for (const d of decorations) {
    if (d.type === "image") {
      slide.addImage({
        path: decorAssetPath(d),
        x: d.x || 0,
        y: d.y || 0,
        w: d.w || 1,
        h: d.h || 1,
        rotate: d.rotate || undefined,
        altText: d.asset || "template-image",
      });

    } else if (d.type === "rect" || d.type === "roundRect" || d.type === "pill") {
      // Solid color block / rounded card / full-radius pill. Optional text label.
      const shape = d.type === "rect" ? "rect" : "roundRect";
      const opts = {
        x: d.x || 0, y: d.y || 0, w: d.w || 1, h: d.h || 0.5,
      };
      if (d.fill) opts.fill = { color: hex(d.fill), transparency: d.alpha || 0 };
      else opts.fill = { type: "none" };
      if (d.line) opts.line = { color: hex(d.line), width: d.line_width || 1 };
      else opts.line = { type: "none" };
      if (shape === "roundRect") opts.rectRadius = d.type === "pill" ? (d.h || 0.5) / 2 : (d.radius != null ? d.radius : 0.12);
      slide.addShape(shape, opts);
      if (d.text) {
        slide.addText(d.text, {
          x: d.x || 0, y: d.y || 0, w: d.w || 1, h: d.h || 0.5,
          fontFace: d.font || FONT_BOLD, fontSize: d.size || 12,
          color: hex(d.text_color || "#FFFFFF"), bold: !!d.bold,
          align: d.align || "center", valign: "middle",
          charSpacing: d.char_spacing != null ? d.char_spacing : CHAR_SPACING,
        });
      }

    } else if (d.type === "ellipse" || d.type === "ring") {
      const opts = { x: d.x || 0, y: d.y || 0, w: d.w || 1, h: d.h || (d.w || 1) };
      if (d.type === "ring" || !d.fill) {
        opts.fill = { type: "none" };
        opts.line = { color: hex(d.line || d.color || "#FFFFFF"), width: d.line_width || 2 };
      } else {
        opts.fill = { color: hex(d.fill), transparency: d.alpha || 0 };
        opts.line = { type: "none" };
      }
      slide.addShape("ellipse", opts);

    } else if (d.type === "text") {
      slide.addText(d.text || "", {
        x: d.x || 0, y: d.y || 0, w: d.w || 4, h: d.h || 1,
        fontFace: d.font || FONT_BOLD, fontSize: d.size || 14,
        color: hex(d.color || "#000000"), bold: !!d.bold,
        align: d.align || "left", valign: d.valign || "top",
        charSpacing: d.char_spacing != null ? d.char_spacing : CHAR_SPACING,
        transparency: d.transparency != null ? d.transparency : undefined,
      });

    } else if (d.type === "line") {
      slide.addShape("rect", {
        x: d.x || 0,
        y: d.y || 0,
        w: d.w || 1,
        h: 0,
        line: { color: (d.color || "#000000").replace("#", ""), width: d.width || 1 },
      });

    } else if (d.type === "confidential_mark") {
      const role = fontRoles.confidential_mark || {};
      const mX = d.x || 0, mY = d.y || 0, mW = d.w || 1, mH = d.h || 0.3;
      const bColor = role.borderColor || "C00000";
      const bPt = role.borderWidth || 1;
      slide.addShape("rect", {
        x: mX, y: mY, w: mW, h: mH,
        line: { color: bColor, width: bPt },
      });
      slide.addText(d.text || "Confidential", {
        x: mX, y: mY, w: mW, h: mH,
        fontFace: role.font || "Pretendard",
        fontSize: role.size || 14,
        color: role.color || "C00000",
        align: role.align || "center",
        valign: "middle",
      });

    } else if (d.type === "disclaimer") {
      const role = fontRoles.disclaimer || {};
      slide.addText(
        d.text || "※ 본 문서는 대외비입니다.",
        {
          x: d.x || 0,
          y: d.y || 0,
          w: d.w || 1,
          h: d.h || 0.2,
          fontFace: role.font || FONT_LIGHT,
          fontSize: role.size || 6,
          color: role.color || "666666",
          align: role.align || "left",
        }
      );
    }
    // slide_number intentionally removed — reference template has none
  }
}

// ── Body shape rendering (individual shapes per line) ────────────────────

/**
 * Add body items as individual shapes to a slide.
 * Each section header and bullet item is a separate positioned shape.
 *
 * @param {object} slide - pptxgenjs slide
 * @param {Array} items - AST items (section, bullet, numbered, text)
 * @param {number} startY - Starting y position
 * @param {number} maxX - Max width for positioning
 * @returns {number} The y position after the last item
 */
function addBodyShapes(slide, items, startY, maxX, bottomY, originX) {
  const denseFlow = shouldUseDenseBodyFlow(items, maxX, startY, bottomY || 7.0);
  const columns = denseFlow ? 2 : 1;
  const colGap = denseFlow ? 0.16 : 0;
  const colW = (maxX - colGap * (columns - 1)) / columns;
  let col = 0;
  let y = startY;
  // Template regions have always drawn body text at the template's own left
  // margin. A placed box carries its own, and passes it here.
  const baseX = originX != null ? originX : SEC_HEADER_X;
  const bodyIndent = denseFlow ? 0.13 : (BULLET_X - SEC_HEADER_X);
  const BODY_FULL_W = 10.188;
  const scale = colW / BODY_FULL_W;
  const secW = denseFlow ? Math.max(1.4, colW - 0.04) : SEC_HEADER_W * scale;
  const bulletW = denseFlow ? Math.max(1.2, colW - bodyIndent - 0.02) : BULLET_W * scale;
  let numberedCounter = 0;
  const style = denseFlow ? chooseDenseBodyStyle() : chooseBodyStyle(items, bulletW, startY, bottomY || 7.0);

  function colX() { return baseX + col * (colW + colGap); }
  function secX() { return colX(); }
  function bulletX() { return colX() + bodyIndent; }
  function maybeAdvanceColumn(nextHeight) {
    if (!denseFlow || col >= columns - 1) return;
    if (y + nextHeight > (bottomY || 7.0)) {
      col++;
      y = startY;
    }
  }

  for (const item of items) {
    if (item.type === "section") {
      const sectionH = estimateTextHeight(item.heading, secW, style.sectionSize, style.lineSpacing);
      const cardH = estimateSectionHeight(item, secW, bulletW, style);
      maybeAdvanceColumn(Math.min(cardH, sectionH + 0.2));
      addSectionCard(slide, secX() - 0.035, y - 0.03, Math.max(secW, bulletW + bodyIndent) + 0.07, cardH);
      // Section header — separate shape, black, 1.5 line spacing
      slide.addText(mdRuns(item.heading, {
        fontFace: SEC_HEADER_FONT,
        fontSize: style.sectionSize,
        color: SEC_HEADER_COLOR,
        charSpacing: CHAR_SPACING,
      }), {
        x: secX(),
        y: y,
        w: secW,
        h: sectionH,
        lineSpacingMultiple: style.lineSpacing,
      });
      y += sectionH + style.gap;

      // Numbered children with (1)(2)(3) format
      if (item.children) {
        numberedCounter = 0;
        for (const child of item.children) {
          numberedCounter++;
          const numPrefix = `(${numberedCounter})  `;
          const text = numPrefix + cleanMd(child.text);
          const h = estimateTextHeight(text, bulletW, style.bodySize, style.lineSpacing);
          maybeAdvanceColumn(h);
          slide.addText([
            { text: numPrefix, options: { fontFace: FONT_MEDIUM, fontSize: style.bodySize, color: "000000", charSpacing: CHAR_SPACING } },
            ...mdRuns(child.text, { fontFace: FONT_MEDIUM, fontSize: style.bodySize, color: "000000", charSpacing: CHAR_SPACING }),
          ], {
            x: bulletX(),
            y: y,
            w: bulletW,
            h,
            lineSpacingMultiple: style.lineSpacing,
          });
          y += h + style.gap;
        }
      }
      y += 0.08;

    } else if (item.type === "bullet") {
      const h = estimateTextHeight(item.text, bulletW, style.bodySize, style.lineSpacing);
      maybeAdvanceColumn(h);
      // Bullet item — green prefix + black text
      slide.addText([
        { text: BULLET_PREFIX, options: { fontFace: FONT_BOLD, fontSize: style.bodySize, color: BULLET_COLOR, charSpacing: CHAR_SPACING } },
        ...mdRuns(item.text, { fontFace: FONT_MEDIUM, fontSize: style.bodySize, color: "000000", charSpacing: CHAR_SPACING }),
      ], {
        x: bulletX(),
        y: y,
        w: bulletW,
        h,
        lineSpacingMultiple: style.lineSpacing,
      });
      y += h + style.gap;

      // Children (numbered sub-items)
      if (item.children) {
        numberedCounter = 0;
        for (const child of item.children) {
          numberedCounter++;
          const numPrefix = `(${numberedCounter})  `;
          const text = numPrefix + cleanMd(child.text);
          const childH = estimateTextHeight(text, bulletW, style.bodySize, style.lineSpacing);
          maybeAdvanceColumn(childH);
          slide.addText([
            { text: numPrefix, options: { fontFace: FONT_MEDIUM, fontSize: style.bodySize, color: "000000", charSpacing: CHAR_SPACING } },
            ...mdRuns(child.text, { fontFace: FONT_MEDIUM, fontSize: style.bodySize, color: "000000", charSpacing: CHAR_SPACING }),
          ], {
            x: bulletX(),
            y: y,
            w: bulletW,
            h: childH,
            lineSpacingMultiple: style.lineSpacing,
          });
          y += childH + style.gap;
        }
      }

    } else if (item.type === "numbered") {
      numberedCounter++;
      const numPrefix = `(${numberedCounter})  `;
      const text = numPrefix + cleanMd(item.text);
      const h = estimateTextHeight(text, bulletW, style.bodySize, style.lineSpacing);
      maybeAdvanceColumn(h);
      slide.addText([
        { text: numPrefix, options: { fontFace: FONT_MEDIUM, fontSize: style.bodySize, color: "000000", charSpacing: CHAR_SPACING } },
        ...mdRuns(item.text, { fontFace: FONT_MEDIUM, fontSize: style.bodySize, color: "000000", charSpacing: CHAR_SPACING }),
      ], {
        x: bulletX(),
        y: y,
        w: bulletW,
        h,
        lineSpacingMultiple: style.lineSpacing,
      });
      y += h + style.gap;

    } else if (item.type === "text") {
      const h = estimateTextHeight(item.text, bulletW, style.bodySize, style.lineSpacing);
      maybeAdvanceColumn(h);
      slide.addText(mdRuns(item.text, {
        fontFace: FONT_MEDIUM,
        fontSize: style.bodySize,
        color: "000000",
        charSpacing: CHAR_SPACING,
      }), {
        x: bulletX(),
        y: y,
        w: bulletW,
        h,
        lineSpacingMultiple: style.lineSpacing,
      });
      y += h + style.gap;
    }
  }

  return y;
}

/**
 * Add summary group content as individual shapes.
 * Uses narrow width (~4.3" for headers, ~4.1" for bullets).
 */
function addSummaryShapes(slide, content, region) {
  let y = region.y || 1.04;

  // Group heading
  if (content.heading) {
    slide.addText(mdRuns(content.heading, {
      fontFace: SEC_HEADER_FONT,
      fontSize: SEC_HEADER_SIZE,
      color: SEC_HEADER_COLOR,
      charSpacing: CHAR_SPACING,
    }), {
      x: region.x || 0.39,
      y: y,
      w: SUMMARY_HEADER_W,
      h: SEC_HEADER_H,
    });
    y += SEC_HEADER_H + 0.08;
  }

  // Items
  if (content.items) {
    for (const item of content.items) {
      if (item.type === "section") {
        // Section header
        slide.addText(mdRuns(item.heading, {
          fontFace: SEC_HEADER_FONT,
          fontSize: SEC_HEADER_SIZE,
          color: SEC_HEADER_COLOR,
          charSpacing: CHAR_SPACING,
        }), {
          x: region.x || 0.39,
          y: y,
          w: SUMMARY_HEADER_W,
          h: SEC_HEADER_H,
        });
        y += SEC_HEADER_H + 0.05;

        // Children as bullet items
        if (item.children) {
          for (const child of item.children) {
            slide.addText([
              { text: BULLET_PREFIX, options: { fontFace: FONT_BOLD, fontSize: SUMMARY_BULLET_SIZE, color: BULLET_COLOR, charSpacing: CHAR_SPACING } },
              ...mdRuns(child.text, { fontFace: FONT_MEDIUM, fontSize: SUMMARY_BULLET_SIZE, color: "000000", charSpacing: CHAR_SPACING }),
            ], {
              x: 0.59,
              y: y,
              w: SUMMARY_BULLET_W,
              h: SUMMARY_BULLET_H,
              lineSpacingMultiple: SUMMARY_BULLET_LINE_SPACING,
            });
            y += SUMMARY_BULLET_Y_SPACING;
          }
        }

      } else if (item.type === "bullet") {
        slide.addText([
          { text: BULLET_PREFIX, options: { fontFace: FONT_BOLD, fontSize: SUMMARY_BULLET_SIZE, color: BULLET_COLOR, charSpacing: CHAR_SPACING } },
          ...mdRuns(item.text, { fontFace: FONT_MEDIUM, fontSize: SUMMARY_BULLET_SIZE, color: "000000", charSpacing: CHAR_SPACING }),
        ], {
          x: 0.59,
          y: y,
          w: SUMMARY_BULLET_W,
          h: SUMMARY_BULLET_H,
          lineSpacingMultiple: SUMMARY_BULLET_LINE_SPACING,
        });
        y += SUMMARY_BULLET_Y_SPACING;

        if (item.children) {
          for (const child of item.children) {
            slide.addText([
              { text: BULLET_PREFIX, options: { fontFace: FONT_BOLD, fontSize: SUMMARY_BULLET_SIZE, color: BULLET_COLOR, charSpacing: CHAR_SPACING } },
              ...mdRuns(child.text, { fontFace: FONT_MEDIUM, fontSize: SUMMARY_BULLET_SIZE, color: "000000", charSpacing: CHAR_SPACING }),
            ], {
              x: 0.59,
              y: y,
              w: SUMMARY_BULLET_W,
              h: SUMMARY_BULLET_H,
              lineSpacingMultiple: SUMMARY_BULLET_LINE_SPACING,
            });
            y += SUMMARY_BULLET_Y_SPACING;
          }
        }

      } else if (item.type === "numbered") {
        slide.addText([
          { text: BULLET_PREFIX, options: { fontFace: FONT_BOLD, fontSize: SUMMARY_BULLET_SIZE, color: BULLET_COLOR, charSpacing: CHAR_SPACING } },
          ...mdRuns(item.text, { fontFace: FONT_MEDIUM, fontSize: SUMMARY_BULLET_SIZE, color: "000000", charSpacing: CHAR_SPACING }),
        ], {
          x: 0.59,
          y: y,
          w: SUMMARY_BULLET_W,
          h: SUMMARY_BULLET_H,
          lineSpacingMultiple: SUMMARY_BULLET_LINE_SPACING,
        });
        y += SUMMARY_BULLET_Y_SPACING;
      }
    }
  }
}

// ── TOC rendering (separate shapes per item) ─────────────────────────────

/**
 * Add TOC items as separate text shapes, matching TEMPLATE-PPTX.pptx exactly.
 * Each item is: "N.  text" in the template title font at 18pt, w=7.5, h=0.55, spaced 0.65" apart.
 */
function addTocShapes(slide, items) {
  let y = TOC_Y_START;
  let num = 1;

  for (const item of items) {
    const text = `${num}.  ${cleanMd(item.text || item.heading || "")}`;
    slide.addText(text, {
      x: TOC_X,
      y: y,
      w: TOC_W,
      h: TOC_H,
      fontFace: TOC_FONT,
      fontSize: TOC_SIZE,
      color: TOC_COLOR,
      charSpacing: CHAR_SPACING,
    });
    y += TOC_Y_SPACING;
    num++;
  }
}

/**
 * Check if a slide is a TOC slide by inspecting the title region content.
 */
function isTocSlide(regions) {
  const title = regions.title;
  if (!title || typeof title.content !== "string") return false;
  return title.content.includes("목차");
}

function adjustedRegionsForImageColumn(regions) {
  const body = regions.body;
  const image = regions.image;
  if (!body || !image || !body.content || !image.content) return regions;
  if (body.content.type !== "body" || !["image", "image-grid"].includes(image.content.type)) return regions;

  const bodyX = body.x || 0;
  const bodyW = body.w || 10.188;
  const imageX = image.x || 0;
  const gap = 0.25;
  if (imageX <= bodyX || imageX >= bodyX + bodyW) return regions;

  const denseImageGrid = image.content.type === "image-grid" && Array.isArray(image.content.images) && image.content.images.length >= 6;
  return {
    ...regions,
    body: {
      ...body,
      w: Math.max(0.5, imageX - bodyX - gap),
    },
    image: denseImageGrid ? {
      ...image,
      y: Math.min(image.y || 1.5, 1.08),
      h: Math.max(image.h || 3.0, 5.85),
    } : image,
    figure_caption: denseImageGrid && regions.figure_caption ? {
      ...regions.figure_caption,
      y: Math.max(regions.figure_caption.y || 4.55, 7.02),
    } : regions.figure_caption,
  };
}

// ── Region rendering ────────────────────────────────────────────────────────

/**
 * Add a region as a positioned element on the slide.
 *
 * Content types:
 *   - string:               title, main-box, notes
 *   - { type: "body" }      bullet/section/numbered items → individual shapes
 *   - { type: "kpi-table" } table with headers and rows
 *   - { type: "image" }     image element
 *   - { type: "figure-caption" } figure caption (auto-numbered "도 N.")
 *   - { type: "table-caption" }  table caption (auto-numbered "표 N.")
 *   - { type: "summary-group" }  heading + items → individual shapes
 */
function addRegion(slide, name, region, fontRoles, pageH, regionBottom, isToc, sourceDir) {
  if (!region) return;

  const content = region.content;
  if (content === undefined || content === null || (typeof content === "string" && !content.trim())) return;
  if (typeof content === "object" && !content.type) return;

  const roleName = region.font_role || region.heading_role || region.sub_item_role;
  const role = fontRoles[roleName] || {};

  // ── String content (title, main-box, notes) ────────────────────────
  if (typeof content === "string") {
    const opts = {
      x: region.x || 0,
      y: region.y || 0,
      w: region.w || 4,
      h: region.h || ((regionBottom || (pageH - 0.5)) - (region.y || 0)),
      fontFace: role.font || FONT_BOLD,
      fontSize: role.size || 16,
      color: (role.color || "000000").replace("#", ""),
      align: region.align || role.align || "left",
      valign: region.valign || "top",
    };

    if (role.charSpacing != null) opts.charSpacing = role.charSpacing;
    if (role.lineSpacing) opts.lineSpacingMultiple = role.lineSpacing;

    // Border (main_box)
    if (region.border) {
      opts.line = {
        color: (region.border.color || "#000000").replace("#", ""),
        width: region.border.width || 1,
      };
    }

    // Autofit
    if (region.autofit === "resize") opts.autoFit = true;
    else if (region.autofit === "shrink") opts.shrinkText = true;

    slide.addText(mdRuns(content, {
      fontFace: opts.fontFace,
      fontSize: opts.fontSize,
      color: opts.color,
      ...(opts.charSpacing != null ? { charSpacing: opts.charSpacing } : {}),
    }), opts);
    return;
  }

  // ── Body content → TOC shapes or individual shapes ──────────────────
  if (content.type === "body") {
    if (isToc) {
      addTocShapes(slide, content.items || []);
    } else {
      const startY = region.y || 1.044;
      addBodyShapes(slide, content.items || [], startY, region.w || 10.188, regionBottom || pageH - 0.5, region.originX);
    }
    return;
  }

  // ── KPI Table ──────────────────────────────────────────────────────
  if (content.type === "kpi-table") {
    const headerRole = fontRoles[region.font_role_header] || fontRoles.table_header;
    const dataRole = fontRoles[region.font_role_data] || fontRoles.table_data;

    const tableData = [];

    if (content.headers && content.headers.length > 0) {
      tableData.push(
        content.headers.map((h) => ({
          text: cleanMd(h),
          options: {
            bold: false,
            fontSize: headerRole ? headerRole.size : 14,
            fontFace: headerRole ? headerRole.font : FONT_BOLD,
            color: headerRole ? headerRole.color : "000000",
            align: headerRole ? headerRole.align : "left",
            valign: "middle",
            ...(headerRole && headerRole.charSpacing != null
              ? { charSpacing: headerRole.charSpacing }
              : {}),
            ...(headerRole && headerRole.fill
              ? { fill: { color: headerRole.fill.replace("#", "") } }
              : {}),
          },
        }))
      );
    }

    if (content.rows) {
      for (const row of content.rows) {
        tableData.push(
          row.map((cell) => linkedTableCell(cell, {
              fontSize: dataRole ? dataRole.size : 14,
              fontFace: dataRole ? dataRole.font : FONT_MEDIUM,
              color: dataRole ? dataRole.color : "000000",
              align: dataRole ? dataRole.align : "left",
              valign: "middle",
              ...(dataRole && dataRole.charSpacing != null
                ? { charSpacing: dataRole.charSpacing }
                : {}),
            }))
        );
      }
    }

    const numCols = (content.headers && content.headers.length) || 1;
    const tblX = region.x || 0;
    const tblY = region.y || 0;
    const tblW = region.w || 4;
    slide.addTable(tableData, {
      x: tblX,
      y: tblY,
      w: tblW,
      border: { pt: 1.5, color: "000000" },
      colW: Array(numCols).fill(tblW / numCols),
      margin: [3.6, 7.2, 3.6, 7.2],
      rowH: 0.35,
    });
    return;
  }

  // ── Image ──────────────────────────────────────────────────────────
  if (content.type === "image") {
    const imgPath = resolveImagePath(content.src, sourceDir);
    const fit = containBox(
      region.x || 0,
      region.y || 0,
      region.w || 2,
      region.h || 1,
      readImageSize(imgPath),
    );
    slide.addImage({
      path: imgPath,
      ...fit,
      altText: content.caption || path.basename(content.src || imgPath),
    });
    return;
  }

  if (content.type === "image-grid") {
    const images = Array.isArray(content.images) ? content.images : [];
    const count = images.length;
    if (count === 0) return;
    const cols = count <= 2 ? count : 2;
    const rows = Math.ceil(count / cols);
    const gap = 0.06;
    const baseX = region.x || 0;
    const baseY = region.y || 0;
    const baseW = region.w || 4;
    const baseH = region.h || 3;
    const cellW = (baseW - gap * (cols - 1)) / cols;
    const cellH = (baseH - gap * (rows - 1)) / rows;
    images.forEach((image, idx) => {
      const imgPath = resolveImagePath(image.src, sourceDir);
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const fit = containBox(
        baseX + col * (cellW + gap),
        baseY + row * (cellH + gap),
        cellW,
        cellH,
        readImageSize(imgPath),
      );
      slide.addImage({
        path: imgPath,
        ...fit,
        altText: image.caption || path.basename(image.src || imgPath),
      });
    });
    return;
  }

  // ── Figure Caption ────────────────────────────────────────────────
  if (content.type === "figure-caption") {
    const num = content.number || 1;
    const prefix = content.prefix || "도";
    const captionText = content.caption ? `${prefix} ${num}. ${cleanMd(content.caption)}` : `${prefix} ${num}.`;
    const captionRole = fontRoles.figure_caption || {};
    const captionW = region.w || 4;
    const captionSize = captionRole.size || 16;
    const captionSpacing = captionRole.lineSpacing || 1.3;
    slide.addText(captionText, {
      x: region.x || 0,
      y: region.y || 0,
      w: captionW,
      // A caption that wraps needs a box tall enough to hold every line, or it
      // overflows its frame. The declared region height is the floor, not the cap.
      h: Math.max(
        region.h || 0.456,
        estimateTextHeight(captionText, captionW, captionSize, captionSpacing)
      ),
      fontFace: captionRole.font || FONT_MEDIUM,
      fontSize: captionSize,
      color: (captionRole.color || "000000").replace("#", ""),
      align: region.align || captionRole.align || "center",
      charSpacing: captionRole.charSpacing != null ? captionRole.charSpacing : CHAR_SPACING,
      lineSpacingMultiple: captionRole.lineSpacing || 1.3,
    });
    return;
  }

  // ── Table Caption ─────────────────────────────────────────────────
  if (content.type === "table-caption") {
    const num = content.number || 1;
    const prefix = content.prefix || "표";
    const captionText = content.caption ? `${prefix} ${num}. ${cleanMd(content.caption)}` : `${prefix} ${num}.`;
    const captionRole = fontRoles.table_caption || {};
    const captionW = region.w || 4;
    const captionSize = captionRole.size || 16;
    const captionSpacing = captionRole.lineSpacing || 1.3;
    slide.addText(captionText, {
      x: region.x || 0,
      y: region.y || 0,
      w: captionW,
      // Same rule as the figure caption: the declared region height is the
      // floor, not the cap, or a wrapping caption overflows its frame.
      h: Math.max(
        region.h || 0.456,
        estimateTextHeight(captionText, captionW, captionSize, captionSpacing)
      ),
      fontFace: captionRole.font || FONT_MEDIUM,
      fontSize: captionSize,
      color: (captionRole.color || "000000").replace("#", ""),
      align: region.align || captionRole.align || "center",
      charSpacing: captionRole.charSpacing != null ? captionRole.charSpacing : CHAR_SPACING,
      lineSpacingMultiple: captionRole.lineSpacing || 1.3,
    });
    return;
  }

  // ── Summary Group → individual shapes ──────────────────────────────
  if (content.type === "summary-group") {
    addSummaryShapes(slide, content, region);
    return;
  }
}

// ── AZURE rich rendering (isolated; only used when template.render_style==="azure") ──

/** Split a title string into runs, emphasizing **word** in the primary color. */
function azureTitleRuns(text, P) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((p) =>
    p.startsWith("**") && p.endsWith("**")
      ? { text: p.slice(2, -2), options: { color: hex(P.primary) } }
      : { text: p, options: {} }
  );
}

/** Strip leftover markdown markers (### heading, list dashes, **bold**, `code`)
 *  from inline text, returning a clean plain string. */
function cleanMd(s) {
  return String(s || "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*[*-]\s+/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`/g, "")
    .trim();
}

/** Convert inline markdown in `text` to pptxgenjs styled runs: **x** → a bold
 *  run, plain segments → normal runs. Leading heading/list markers and backticks
 *  are stripped. `runOpts` styles every run; bold runs additionally set bold.
 *  Guarantees no raw "**", "###", or backtick reaches the rendered <a:t>. */
function mdRuns(text, runOpts = {}) {
  const clean = String(text || "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*[*-]\s+/, "")
    .replace(/`/g, "");
  const parts = clean.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "");
  if (parts.length === 0) return [{ text: "", options: { ...runOpts } }];
  return parts.map((p) =>
    p.startsWith("**") && p.endsWith("**")
      ? { text: p.slice(2, -2), options: { ...runOpts, bold: true } }
      : { text: p, options: { ...runOpts } }
  );
}

/** Convert body items into up to 4 cards: {heading, lines[]}.
 *  Handles both authoring styles:
 *   - `### Title` (parsed as `text`) followed by `- **point**` (a `section`) → one card
 *     titled by the heading, the section folded into the body.
 *   - bare `- **Title**` sections → one card each (heading = bold title). */
function bodyToCards(items) {
  const cards = [];
  let cur = null;
  for (const item of items || []) {
    if (item.type === "text" && item.text) {
      cur = { heading: cleanMd(item.text), lines: [] };
      cards.push(cur);
    } else if (item.type === "section" || item.type === "bullet") {
      const head = cleanMd(item.heading || item.text || "");
      const kids = (item.children || []).map((c) => cleanMd(c.text)).filter(Boolean);
      if (cur && cur.lines.length === 0 && cur.heading) {
        // fold this section under the preceding heading card
        if (head) cur.lines.push(head);
        kids.forEach((k) => cur.lines.push("  " + k));
      } else {
        cur = { heading: head, lines: kids };
        cards.push(cur);
      }
    } else if (item.type === "numbered" && item.text) {
      if (cur) cur.lines.push(cleanMd(item.text));
      else { cur = { heading: "", lines: [cleanMd(item.text)] }; cards.push(cur); }
    }
  }
  return cards.slice(0, 4);
}

/** Draw one rounded card with a numbered chip, heading, and body lines. */
function drawAzureCard(slide, x, y, w, h, card, idx, P, emphasized) {
  const bg = emphasized ? hex(P.primary_deep) : hex(P.tint);
  const headColor = emphasized ? "FFFFFF" : hex(P.ink);
  const bodyColor = emphasized ? hex(P.emphasisTextColor) : hex(P.ink_muted);
  slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.16, fill: { color: bg }, line: { type: "none" } });
  const pad = 0.30;
  // numbered chip
  const chip = 0.52;
  slide.addShape("roundRect", {
    x: x + pad, y: y + pad, w: chip, h: chip, rectRadius: 0.12,
    fill: { color: emphasized ? "FFFFFF" : hex(P.primary) }, line: { type: "none" },
  });
  // Number sits in a text box whose rect is identical to the chip rect, with
  // margin:0 and tight line spacing so the numeral reads dead-centre.
  slide.addText(String(idx + 1).padStart(2, "0"), {
    x: x + pad, y: y + pad, w: chip, h: chip, align: "center", valign: "middle",
    fontFace: P.titleFont, fontSize: 15, bold: true,
    color: emphasized ? hex(P.primary_deep) : "FFFFFF",
    margin: 0, lineSpacingMultiple: 1,
  });
  if (card.heading) {
    slide.addText(card.heading, {
      x: x + pad, y: y + pad + chip + 0.18, w: w - 2 * pad, h: 0.4,
      fontFace: P.titleFont, fontSize: 15, bold: true, color: headColor, align: "left", valign: "top",
      charSpacing: -0.3,
    });
  }
  const bodyY = y + pad + chip + (card.heading ? 0.62 : 0.18);
  const bodyH = h - (bodyY - y) - 0.18;
  if (card.bodyRuns && card.bodyRuns.length) {
    slide.addText(card.bodyRuns, {
      x: x + pad, y: bodyY, w: w - 2 * pad, h: bodyH,
      color: bodyColor, align: "left", valign: "top", lineSpacingMultiple: card.lineSpacing || 1.28, charSpacing: -0.2,
    });
  } else if (card.lines && card.lines.length) {
    // Shrink body font when there are many lines so it never exceeds the frame.
    const fs = card.lines.length > 4 ? 10.5 : 11.5;
    slide.addText(card.lines.join("\n"), {
      x: x + pad, y: bodyY, w: w - 2 * pad, h: bodyH,
      fontFace: P.bodyFont, fontSize: fs, color: bodyColor, align: "left", valign: "top",
      lineSpacingMultiple: 1.3, charSpacing: -0.2,
    });
  }
}

/** Render content/main body as a row of cards. */
function renderAzureCards(slide, items, region, P) {
  const cards = bodyToCards(items);
  if (!cards.length) return;
  const n = cards.length;
  const x0 = region.x || 0.6, y0 = region.y || 1.6, w = region.w || 12.1;
  const h = region.h || 3.0;
  const gap = 0.28;
  const cardW = (w - (n - 1) * gap) / n;
  cards.forEach((c, i) => {
    drawAzureCard(slide, x0 + i * (cardW + gap), y0, cardW, h, c, i, P, n >= 3 && i === n - 1);
  });
}

/** Flatten body/summary items (sections + children + bullets) into styled runs.
 *  `scale` (≤1) shrinks fonts to fit a fixed card height. */
function itemsToRuns(items, P, scale = 1) {
  const s = (v) => Math.max(8, Math.round(v * scale * 10) / 10);
  const runs = [];
  for (const it of items || []) {
    if (it.type === "section") {
      runs.push({ text: cleanMd(it.heading || ""), options: { bold: true, fontFace: P.titleFont, fontSize: s(12.5), color: hex(P.ink), breakLine: true } });
      for (const c of it.children || []) {
        runs.push({ text: "  " + cleanMd(c.text || ""), options: { fontFace: P.bodyFont, fontSize: s(11), color: hex(P.ink_muted), breakLine: true } });
      }
    } else if (it.text) {
      runs.push({ text: (it.type === "numbered" ? "  " : "• ") + cleanMd(it.text), options: { fontFace: P.bodyFont, fontSize: s(11.5), color: hex(P.ink_muted), breakLine: true } });
    }
  }
  return runs;
}

/** Estimate the rendered height of a group's items at a given font scale,
 *  using the same conservative metric inventory respects (estimateTextHeight). */
function estimateGroupHeight(items, innerW, scale, lineSpacing) {
  let hsum = 0;
  for (const it of items || []) {
    if (it.type === "section") {
      hsum += estimateTextHeight(it.heading || "", innerW, 12.5 * scale, lineSpacing);
      for (const c of it.children || []) hsum += estimateTextHeight("  " + (c.text || ""), innerW - 0.1, 11 * scale, lineSpacing);
    } else if (it.text) {
      hsum += estimateTextHeight(it.text, innerW, 11.5 * scale, lineSpacing);
    }
  }
  return hsum;
}

/** Render a single summary-group as one card (heading + items, iterative shrink-to-fit). */
function renderAzureGroupCard(slide, content, region, P, idx) {
  const w = region.w || 5.6, h = region.h || 2.4;
  const innerW = w - 0.60;
  const innerH = h - 0.30 - 0.52 - (content.heading ? 0.62 : 0.18) - 0.18;
  let scale = 0.55, ls = 1.12;
  for (const s of [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6, 0.55]) {
    if (estimateGroupHeight(content.items, innerW, s, s < 1 ? 1.12 : 1.28) <= innerH) { scale = s; ls = s < 1 ? 1.12 : 1.28; break; }
  }
  const card = {
    heading: cleanMd(content.heading || ""),
    bodyRuns: itemsToRuns(content.items, P, scale),
    lineSpacing: ls,
  };
  drawAzureCard(slide, region.x || 0.6, region.y || 1.6, w, h, card, idx, P, false);
}

/** Render a general data table (palette-styled): primary header, zebra tint rows. */
function renderAzureTable(slide, content, region, P) {
  const headers = content.headers || [];
  const rows = content.rows || [];
  if (!headers.length) return;
  const x = region.x || 0.6, y = region.y || 1.6, w = region.w || 6.0;
  const numericColumns = headers.map((_, col) => rows.length > 0 && rows.every((row) => numericValue(row[col]) !== null));
  const tableRows = [];
  tableRows.push(headers.map((h, col) => ({
    text: cleanMd(h),
    options: { bold: true, color: "FFFFFF", fill: { color: hex(P.primary) }, fontFace: P.titleFont, fontSize: 12, align: numericColumns[col] ? "right" : "left", valign: "middle" },
  })));
  rows.forEach((r, ri) => {
    tableRows.push(r.map((c, col) => linkedTableCell(c, {
      color: hex(P.ink), fill: { color: ri % 2 ? "FFFFFF" : hex(P.tint) }, fontFace: P.bodyFont, fontSize: 11.5, align: numericColumns[col] ? "right" : "left", valign: "middle",
    })));
  });
  slide.addTable(tableRows, {
    x, y, w, colW: Array(headers.length).fill(w / headers.length),
    border: { type: "solid", color: hex(P.line), pt: 0.5 }, rowH: 0.4, margin: 0.06, autoPage: false,
  });
}

function numericValue(cell) {
  const value = cleanMd(cell).replace(/[\s,]/g, "").replace(/^[₩$€]/, "").replace(/%$/, "");
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : null;
}

/** A period/category column plus at least two fully numeric rows is a series. */
function chartSeries(content) {
  const { headers = [], rows = [] } = content;
  if (/^(?:표|table\b)/i.test(cleanMd(content.caption || ""))) return null;
  if (headers.length < 2 || rows.length < 2 || rows.some((row) => row.length !== headers.length)) return null;
  const series = headers.slice(1).map((name, index) => ({
    name: cleanMd(name),
    labels: rows.map((row) => cleanMd(row[0])),
    values: rows.map((row) => numericValue(row[index + 1])),
  }));
  return series.every((item) => item.values.every((value) => value !== null)) ? series : null;
}

function renderAzureChart(slide, content, region, P, pptx) {
  const series = chartSeries(content);
  if (!series || !pptx) return false;
  slide.addChart(pptx.ChartType.bar, series, {
    x: region.x || 0.84, y: region.y || 2.05,
    w: region.w || 11.65, h: region.h > 2.8 ? region.h : 3.4,
    barDir: "col", showLegend: series.length > 1,
    chartColors: [hex(P.primary), hex(P.azure_soft), hex(P.primary_deep)],
    showTitle: false, showValue: false,
    catAxisLabelFontFace: P.bodyFont, catAxisLabelFontSize: 11,
    valAxisLabelFontFace: P.bodyFont, valAxisLabelFontSize: 10,
    showMarker: false, showBorder: false,
  });
  return true;
}

/** Render a kpi-table as a row of KPI cards (value + label); first card filled. */
function renderAzureKpi(slide, content, region, P) {
  const cards = kpiCards(content);
  const values = cards.map((c) => c.value);
  const labels = cards.map((c) => c.label);
  const n = Math.min(values.length, 4);
  if (!n) return;
  const x0 = region.x || 0.6, y0 = region.y || 1.6, w = region.w || 12.1, h = Math.max(3.0, region.h || 0);
  const gap = 0.26;
  const cardW = (w - (n - 1) * gap) / n;
  for (let i = 0; i < n; i++) {
    const fill = i === 0;
    const x = x0 + i * (cardW + gap);
    slide.addShape("roundRect", {
      x, y: y0, w: cardW, h, rectRadius: 0.16,
      fill: { color: fill ? hex(P.primary) : "FFFFFF" },
      line: fill ? { type: "none" } : { color: hex(P.line), width: 1 },
    });
    slide.addText(cleanMd(values[i]), {
      x: x + 0.28, y: y0 + 0.70, w: cardW - 0.56, h: 0.9,
      fontFace: P.titleFont, fontSize: 30, bold: true,
      color: fill ? "FFFFFF" : hex(P.primary), align: "left", valign: "middle", charSpacing: -1, margin: 0,
    });
    slide.addText(cleanMd(labels[i]).toUpperCase(), {
      x: x + 0.30, y: y0 + h - 0.72, w: cardW - 0.56, h: 0.4,
      fontFace: P.bodyFont, fontSize: 9.5, bold: false,
      color: fill ? hex(P.emphasisTextColor) : hex(P.ink_muted), align: "left", valign: "middle", charSpacing: 0.4, margin: 0,
    });
  }
}

/** A pipe table reads as KPI in two shapes:
 *   - TALL: 2 cols of value|label pairs, ≤4 pairs, value cell short/metric-like.
 *   - WIDE: 3–4 cols, a single data row of short metric values (labels = header).
 *  Anything else (multi-row, long cells) is a real data table. */


/** Normalize a kpi-table into [{value,label}] cards for both KPI shapes. */
/**
 * Is there room to draw this as KPI badges?
 *
 * A badge stacks a value over a label and reads as one glance, which stops
 * working the moment the card is narrower than its own words: in a column half
 * the slide wide, four badges leave 1.4in each and a label like "영업이익" wraps
 * to one character per line. Below the floor the same data is drawn as a table,
 * which narrows gracefully.
 */
function kpiFits(content, widthIn) {
  const cards = kpiCards(content).length;
  return cards > 0 && (widthIn || 0) / cards >= KPI_MIN_CARD_WIDTH_IN;
}

function kpiCards(content) {
  const headers = content.headers || [];
  const rows = content.rows || [];
  if (headers.length === 2) {
    return [headers, ...rows].slice(0, 4).map((p) => ({ value: p[0], label: p[1] }));
  }
  const row = rows[0] || [];
  return headers.slice(0, 4).map((lab, i) => ({ value: row[i] != null ? row[i] : "", label: lab }));
}

/** Azure region dispatch. Returns true if it fully handled the region.
 *  opts.hasImage = slide also has a populated image region (→ never card the body). */
function renderAzureRegion(slide, layout, name, region, fontRoles, P, opts = {}) {
  const content = region.content;
  if (content == null) return false;
  if (layout === "cover" && name === "title" && typeof content === "string" && content.includes("**")) {
    const role = fontRoles.cover_title || {};
    slide.addText(azureTitleRuns(content, P), {
      x: region.x || 0, y: region.y || 0, w: region.w || 8, h: region.h || 1,
      fontFace: role.font || P.titleFont, fontSize: role.size || 48, bold: role.bold !== false,
      align: role.align || "left", valign: "middle",
      charSpacing: role.charSpacing != null ? role.charSpacing : -1, lineSpacingMultiple: role.lineSpacing || 1.08,
    });
    return true;
  }
  if (typeof content === "object") {
    if (content.type === "body" && (layout === "content" || layout === "main")) {
      // Cards ONLY for section-structured bodies (≥2 ### sections) with no image.
      // Prose bullets, or any body sharing the slide with an image, render as a
      // normal text column (fall through to addRegion) so nothing is cramped.
      const sections = (content.items || []).filter((i) => i.type === "section");
      if (sections.length >= 2 && !opts.hasImage) {
        renderAzureCards(slide, content.items, region, P);
        return true;
      }
      return false;
    }
    if (content.type === "kpi-table") {
      if (renderAzureChart(slide, content, region, P, opts.pptx)) return true;
      if (looksLikeKpi(content) && kpiFits(content, region.w)) {
        renderAzureKpi(slide, content, region, P);
      }
      else renderAzureTable(slide, content, region, P);
      return true;
    }
    if (content.type === "summary-group") {
      const idx = name === "group_bottom" ? 1 : 0;
      renderAzureGroupCard(slide, content, region, P, idx);
      return true;
    }
  }
  return false;
}

// ── Placements (author-positioned boxes and shapes) ─────────────────────────

/** Region name a placed block should be rendered as. */
function partRegionName(blockType) {
  switch (blockType) {
    case "title": return "title";
    case "kpi-table": return "table";
    case "image": return "image";
    case "figure-caption": return "figure_caption";
    case "table-caption": return "table_caption";
    default: return "body";
  }
}

/** font_role a placed block falls back to when its box names none. */
function defaultPartRole(blockType) {
  switch (blockType) {
    case "title": return "section_title";
    case "figure-caption": return "figure_caption";
    case "table-caption": return "table_caption";
    case "notes": return "disclaimer";
    default: return "body_text";
  }
}

function estimatePartHeight(content, widthIn, role) {
  const size = role.size || 13;
  const spacing = role.lineSpacing || 1.3;
  if (typeof content === "string") {
    return estimateTextHeight(content, widthIn, size, spacing) + 0.08;
  }
  if (content && content.type === "body") {
    const text = (content.items || []).map((i) => i.heading || i.text || "").join("\n");
    return estimateTextHeight(text, widthIn, size, spacing) + 0.12;
  }
  return 0.5;
}

/**
 * Turn a shape placement into the decoration element addDecorations reads.
 *
 * A rule is drawn as a zero-height rect whose stroke is the visible mark, so it
 * reads its colour and thickness from `color`/`width` while every other
 * primitive reads `line`/`line_width`. Authors write one spelling — `line=` and
 * `lw=` — and the difference is absorbed here.
 */
function shapeToDecoration(placement, sourceDir) {
  const isRule = placement.shape === "line";
  const element = {
    type: placement.shape,
    x: placement.x, y: placement.y, w: placement.w, h: placement.h,
  };
  for (const [key, value] of Object.entries(placement)) {
    if (["kind", "z", "shape", "x", "y", "w", "h"].includes(key)) continue;
    if (key === "lw") element[isRule ? "width" : "line_width"] = value;
    else if (key === "line" && isRule) element.color = value;
    else if (key === "src") element.assetPath = resolveImagePath(value, sourceDir);
    else element[key] = value;
  }
  return element;
}

/**
 * Render one placed box by flowing its blocks down the box.
 *
 * Every block but the last takes the height its content needs; the last takes
 * whatever is left, so a heading followed by body fills the box rather than
 * floating in its top edge. Nothing here consults the auto-nudge rules: a box
 * lands exactly where the author put it, and the QA gate reports the consequence.
 */
function renderPlacementBox(slide, placement, ctx) {
  const blocks = placement.blocks || [];
  if (blocks.length === 0) return;

  // Columns replace the body region, so they render in the template's own idiom.
  // An explicit box is literal: the author asked for this content, here.
  const useRich = ctx.rich && placement.z === "content";
  const bottom = placement.y + (placement.h != null ? placement.h : 1.0);
  let y = placement.y;

  blocks.forEach((block, i) => {
    const remaining = Math.max(0.2, bottom - y);
    const roleName = placement.role || defaultPartRole(block.type);
    const role = ctx.fontRoles[roleName] || {};
    const content = extractContent(block);
    const isLast = i === blocks.length - 1;
    const h = isLast
      ? remaining
      : Math.min(remaining, Math.max(0.2, estimatePartHeight(content, placement.w, role)));

    const region = {
      x: placement.x, y, w: placement.w, h,
      content,
      font_role: roleName,
      originX: placement.x,
      ...(placement.align ? { align: placement.align } : {}),
      ...(placement.valign ? { valign: placement.valign } : {}),
    };

    const name = partRegionName(block.type);
    const rendered = useRich &&
      renderAzureRegion(slide, ctx.layout, name, region, ctx.fontRoles, ctx.P, { pptx: ctx.pptx });
    if (!rendered) {
      addRegion(slide, name, region, ctx.fontRoles, ctx.pageH, y + h, false, ctx.sourceDir);
    }
    y += h;
  });
}

function renderPlacements(slide, placements, band, ctx) {
  for (const placement of placements) {
    if (placement.z !== band) continue;
    if (placement.kind === "shape") {
      addDecorations(slide, [shapeToDecoration(placement, ctx.sourceDir)], ctx.slideIndex, ctx.fontRoles);
    } else {
      renderPlacementBox(slide, placement, ctx);
    }
  }
}

// ── Main render function ────────────────────────────────────────────────────

/**
 * Render the full resolved spec to a PPTX file.
 *
 * @param {object} resolved - Resolved spec from layout-resolver
 * @param {object} templateObj - Template object from template-registry
 * @param {string} outputPath - Where to write the .pptx file
 * @returns {Promise<string>} Resolves with the output path
 */
async function render(resolved, templateObj, outputPath) {
  const fontRoles = buildFontRoles(templateObj);

  // Derive font, spacing, and accent from the template, with neutral fallbacks.
  const tpl = (templateObj && templateObj.template) || {};
  const tplFonts = tpl.fonts || {};
  const tplType = tpl.global_typography || {};
  FONT_BOLD = tplFonts.title || "Pretendard";
  FONT_MEDIUM = tplFonts.body || "Pretendard";
  FONT_LIGHT = tplFonts.light || "Pretendard";
  CHAR_SPACING = tplType.char_spacing != null ? tplType.char_spacing : -0.7;
  BULLET_FONT = FONT_BOLD;
  SEC_HEADER_FONT = FONT_BOLD;
  TOC_FONT = FONT_BOLD;
  BULLET_COLOR = (tplType.bullet_color || "334155").replace("#", "");
  SECTION_ACCENT = (tplType.section_accent || "334155").replace("#", "");

  // Rich card/KPI/divider rendering uses the enrolled template's palette.
  const rich = tpl.render_style === "azure";
  const pal = tpl.palette || {};
  const P = {
    titleFont: FONT_BOLD, bodyFont: FONT_MEDIUM,
    primary: pal.primary || "#1D4ED8", primary_deep: pal.primary_deep || "#0B2E6F",
    ink: pal.ink || "#0E1B2C", ink_muted: pal.ink_muted || "#51607A",
    tint: pal.tint || "#EEF4FF", line: pal.line || "#D5DEEC", azure_soft: pal.azure_soft || "#93C5FD",
    emphasisTextColor: pal.emphasis_text || "#C9D8F5",
  };

  const dims =
    (templateObj && templateObj.template && templateObj.template.dimensions) || {};
  const pageW = dims.width || 10.833;
  const pageH = dims.height || 7.5;

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "A4_LANDSCAPE", width: pageW, height: pageH });
  pptx.layout = "A4_LANDSCAPE";

  const title = (resolved.deck && resolved.deck.title) || "Presentation";
  pptx.title = title;
  const sourceDir = resolved.sourceDir;
  const cramStress = isCramStressDeck(resolved);

  for (const slideSpec of resolved.slides || []) {
    const slide = pptx.addSlide();

    // Draw order is a band at a time: template decorations, then anything the
    // author put under the content, then the template's regions, then the
    // columns that replaced the body, then anything sitting on top.
    addDecorations(slide, slideSpec.decorations, slideSpec.index, fontRoles);

    const placements = slideSpec.placements || [];
    const placementCtx = {
      rich, P, fontRoles, pageH, sourceDir, pptx,
      layout: slideSpec.layout,
      slideIndex: slideSpec.index,
    };
    renderPlacements(slide, placements, "under", placementCtx);

    const regions = adjustedRegionsForImageColumn(slideSpec.regions || {});
    const chartRegionName = ["table", "kpi_table"].find((name) => regions[name] && chartSeries(regions[name].content || {}));
    if (rich && chartRegionName && regions.body?.content) {
      // Keep one concise takeaway above the plot instead of stacking prose on
      // top of the editable chart's data area.
      regions.body = { ...regions.body, x: 0.84, y: 1.53, w: pageW - 1.68, h: 0.58 };
      const items = regions.body.content.items || [];
      if (items.length && items.every((item) => item.type === "text")) {
        regions.body.content = items.map((item) => item.text).join(" ");
        regions.body.h = 0.78;
      }
      regions[chartRegionName] = { ...regions[chartRegionName], y: 2.40, h: 3.15 };
    }
    if (cramStress && ["content", "main"].includes(slideSpec.layout) && regions.body) {
      renderCramStressSlide(slide, { ...slideSpec, regions }, pageW, pageH, sourceDir);
      continue;
    }

    // Calculate bottom boundary for regions without explicit h
    const bottomBoundary = {};
    for (const [name, region] of Object.entries(regions)) {
      let bottom = pageH - 0.5;
      for (const [otherName, otherRegion] of Object.entries(regions)) {
        if (otherName === name || otherName === "title") continue;
        if (name === "body" && ["image", "figure_caption"].includes(otherName)) continue;
        if (otherRegion.y && otherRegion.y > (region.y || 0) && otherRegion.h) {
          const candidateBottom = otherRegion.y - 0.15;
          if (candidateBottom < bottom) bottom = candidateBottom;
        }
      }
      bottomBoundary[name] = bottom;
    }

    const tocSlide = isTocSlide(regions);
    const hasImage = Object.entries(regions).some(([n, r]) =>
      (n === "image" || n === "figure") && r.content &&
      (r.content.type === "image" || r.content.type === "image-grid"));

    for (const [name, region] of Object.entries(regions)) {
      if (rich && renderAzureRegion(slide, slideSpec.layout, name, region, fontRoles, P, { hasImage, pptx })) continue;
      addRegion(slide, name, region, fontRoles, pageH, bottomBoundary[name], tocSlide, sourceDir);
    }

    renderPlacements(slide, placements, "content", placementCtx);
    renderPlacements(slide, placements, "over", placementCtx);
  }

  await pptx.writeFile({ fileName: outputPath });
  return outputPath;
}

module.exports = { render };
