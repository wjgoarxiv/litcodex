// Cover init script. Injected before any page script in every cover document. A cover frame is a pure
// function of loop time t, and the renderer seeks frames in any order and in fresh browsers, so every
// clock and every unseeded entropy source a page could read throws instead of answering (Math.random
// answers from a fixed seed only while the page builds, before window.ready). Each call is
// recorded by name, so the renderer can name it (exit 18) even when the page swallowed the error. CSS
// animations and transitions would run on the browser's own clock, so they are switched off.
(function litCoverInit() {
	"use strict";
	const w = window;
	const calls = [];
	const refuse = (name, fix) =>
		function refused() {
			if (!calls.includes(name)) calls.push(name);
			throw new Error(`${name} is not allowed in a cover page; ${fix}`);
		};
	const fromT = "draw every frame from t";
	const ownLoop = "the renderer calls renderFrame(t); never run your own loop";

	// Building a scene before window.ready may draw ids from Math.random (three.js names every object it
	// makes): that phase gets a fixed-seed sequence, the same in every browser. Once the page is ready,
	// frames are drawn in any order, so a call then is misuse.
	const refusedRandom = refuse("Math.random", "use LitLoop.rng(seed) for layout and t for motion");
	let seed = 0x9e3779b9;
	w.Math.random = function random() {
		if (w.ready === true) return refusedRandom();
		seed = (seed + 0x6d2b79f5) | 0;
		let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
		return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
	};
	const NativeDate = w.Date;
	function CoverDate(...args) {
		if (!new.target || args.length === 0) return refuse("Date", fromT)();
		return new NativeDate(...args);
	}
	CoverDate.prototype = NativeDate.prototype;
	CoverDate.now = refuse("Date.now", fromT);
	CoverDate.UTC = NativeDate.UTC;
	CoverDate.parse = NativeDate.parse;
	Object.defineProperty(w, "Date", { value: CoverDate, configurable: true, writable: true });
	Object.defineProperty(w.Performance.prototype, "now", { value: refuse("performance.now", fromT), configurable: true, writable: true });
	w.requestAnimationFrame = refuse("requestAnimationFrame", ownLoop);
	w.setInterval = refuse("setInterval", ownLoop);
	if (w.crypto) Object.defineProperty(w.crypto, "getRandomValues", { value: refuse("crypto.getRandomValues", "use LitLoop.rng(seed)"), configurable: true });

	const still = () => {
		const style = w.document.createElement("style");
		style.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; }";
		(w.document.head ?? w.document.documentElement).appendChild(style);
	};
	if (w.document.documentElement) still();
	else w.document.addEventListener("readystatechange", still, { once: true });

	w.__litCoverCalls = () => calls.slice();
})();
