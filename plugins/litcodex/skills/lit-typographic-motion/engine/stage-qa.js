// Stage text QA, page side. Injected only into the QA replay Chrome, never the master. It lists
// text runs (the text of the nearest LitStage.text-marked ancestor, else of the nearest block-level
// ancestor, plus ::before/::after content), their on-screen rects clipped by every clipping
// ancestor, the opacity chain and the effective font size; and it hides all text ink for the B
// capture of the ink mask, cancelling any animation that change would start.
(function litStageQA() {
	"use strict";
	const SKIP = "script, style, noscript, template, title, desc, defs";
	const inlineDisplay = (el) => /^inline/u.test(getComputedStyle(el).display) || getComputedStyle(el).display === "contents";

	function owner(node) {
		const parent = node.parentElement;
		const marked = parent.closest("[data-lit-text]");
		if (marked) return marked;
		const svgText = parent.closest("text");
		if (svgText && parent.ownerSVGElement !== undefined && svgText.ownerSVGElement) return svgText;
		let el = parent;
		while (el && el !== document.body && inlineDisplay(el)) el = el.parentElement;
		return el ?? document.body;
	}

	function opacityChain(el) {
		let opacity = 1;
		for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
			const cs = getComputedStyle(e);
			if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return 0;
			opacity *= Number(cs.opacity);
		}
		return opacity;
	}

	function clipBox(el) {
		let box = [0, 0, window.innerWidth, window.innerHeight];
		for (let e = el.parentElement; e && e !== document.documentElement; e = e.parentElement) {
			const cs = getComputedStyle(e);
			if (cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible" || (cs.clipPath && cs.clipPath !== "none")) {
				const r = e.getBoundingClientRect();
				box = [Math.max(box[0], r.left), Math.max(box[1], r.top), Math.min(box[2], r.right), Math.min(box[3], r.bottom)];
			}
		}
		return box;
	}

	function scaleOf(el) {
		if (typeof el.getScreenCTM === "function" && el.ownerSVGElement) {
			const m = el.getScreenCTM();
			return m ? Math.hypot(m.a, m.b) : 1;
		}
		return el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
	}

	const clipRect = (r, box) => [Math.max(r[0], box[0]), Math.max(r[1], box[1]), Math.min(r[2], box[2]), Math.min(r[3], box[3])];
	const nonEmpty = (r) => r[2] - r[0] >= 1 && r[3] - r[1] >= 1;

	function describe(el, text, rects, index, mark) {
		const cs = getComputedStyle(el);
		const box = clipBox(el);
		const visible = rects.map((r) => clipRect(r, box)).filter(nonEmpty);
		const scale = scaleOf(el);
		const fontSize = Number.parseFloat(cs.fontSize) || 16;
		const clipText = cs.webkitBackgroundClip === "text" || cs.backgroundClip === "text";
		if (mark) el.setAttribute("data-lit-qa-run", String(index));
		return {
			index,
			text,
			rects: visible,
			opacity: opacityChain(el),
			fontSizePx: fontSize * scale,
			weight: Number.parseInt(cs.fontWeight, 10) || 400,
			gradient: clipText && cs.backgroundImage !== "none",
			decor: el.closest('[data-lit-text="decor"]') !== null,
			marked: el.closest("[data-lit-text]")?.dataset.litText ?? null,
			tag: el.tagName.toLowerCase(),
		};
	}

	/** Every visible-candidate text run in the document, in document order. */
	function runs({ mark = false } = {}) {
		const groups = new Map();
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!node.nodeValue.trim() || !node.parentElement || node.parentElement.closest(SKIP)) continue;
			const el = owner(node);
			if (!groups.has(el)) groups.set(el, []);
			groups.get(el).push(node);
		}
		const out = [];
		for (const [el, nodes] of groups) {
			const rects = [];
			for (const node of nodes) {
				const range = document.createRange();
				range.selectNodeContents(node);
				for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) rects.push([r.left, r.top, r.right, r.bottom]);
			}
			const text = nodes.map((n) => n.nodeValue).join("").replace(/\s+/gu, " ").trim();
			out.push(describe(el, text, rects, out.length, mark));
		}
		for (const el of document.body.querySelectorAll("*")) {
			if (el.closest(SKIP)) continue;
			for (const pseudo of ["::before", "::after"]) {
				const content = getComputedStyle(el, pseudo).content;
				const match = /^["'](.*)["']$/su.exec(content ?? "");
				if (!match || !match[1].trim()) continue;
				const r = el.getBoundingClientRect();
				out.push(describe(el, match[1].trim(), [[r.left, r.top, r.right, r.bottom]], out.length, false));
			}
		}
		const canvases = [...document.querySelectorAll("canvas")].filter((c) => {
			const r = c.getBoundingClientRect();
			return r.width >= 32 && r.height >= 32 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight && opacityChain(c) > 0.05;
		}).length;
		return { runs: out, canvases, registered: window.__litClock ? window.__litClock.texts() : [] };
	}

	let before = null;
	const flush = () => document.documentElement.getBoundingClientRect();
	const cancelNew = () => {
		for (const a of document.getAnimations()) if (!before.has(a)) a.cancel();
	};

	/** Hide every glyph's ink (HTML colour, fill and stroke colours; SVG text fill and stroke). */
	function hideText() {
		before = new Set(document.getAnimations());
		for (const el of document.body.querySelectorAll("*")) {
			const cs = getComputedStyle(el);
			if (cs.webkitBackgroundClip === "text" || cs.backgroundClip === "text") el.setAttribute("data-lit-qa-cliptext", "");
		}
		const style = document.createElement("style");
		style.id = "lit-qa-hide";
		style.textContent = "*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; } svg text, svg tspan, svg textPath { fill: transparent !important; stroke: transparent !important; } [data-lit-qa-cliptext] { background-image: none !important; }";
		document.head.appendChild(style);
		flush();
		cancelNew();
		flush();
	}

	function showText() {
		document.getElementById("lit-qa-hide")?.remove();
		for (const el of document.querySelectorAll("[data-lit-qa-cliptext]")) el.removeAttribute("data-lit-qa-cliptext");
		flush();
		cancelNew();
		flush();
		before = null;
	}

	window.__litQA = { runs, hideText, showText };
})();
