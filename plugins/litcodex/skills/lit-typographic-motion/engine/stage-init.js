// Stage init script. Injected before any page script in every stage document, it owns time: Date,
// performance.now, timers, requestAnimationFrame, requestIdleCallback, document.timeline.currentTime
// and Math.random all read one virtual clock that only the renderer advances. It also stubs every
// forbidden element and API and records each use as a contract violation. The renderer passes the
// run's { fps, seed } as the argument of the wrapping call.
(function litStageInit(config) {
	"use strict";
	const w = window;
	const nativeRaf = w.requestAnimationFrame.bind(w);
	const NativeDate = w.Date;
	const EPOCH = NativeDate.UTC(2026, 0, 1, 9, 0, 0);
	const state = { now: 0, loaded: false, timers: new Map(), seq: 0, nextId: 1, rafs: [], violations: [], errors: [], texts: [], webgl: null, anims: new WeakMap(), finished: new WeakSet(), svgBirth: new WeakMap() };
	const violation = (kind, name) => {
		if (!state.violations.some((v) => v.kind === kind && v.name === name)) state.violations.push({ kind, name });
	};

	function VDate(...args) {
		if (!new.target) return new NativeDate(EPOCH + state.now).toString();
		return args.length ? new NativeDate(...args) : new NativeDate(EPOCH + state.now);
	}
	VDate.prototype = NativeDate.prototype;
	VDate.now = () => EPOCH + state.now;
	VDate.UTC = NativeDate.UTC;
	VDate.parse = NativeDate.parse;
	w.Date = VDate;
	Object.defineProperty(w.performance, "now", { value: () => state.now, configurable: true });

	const addTimer = (fn, delay, args, repeat) => {
		const id = state.nextId++;
		const ms = Math.max(0, Number(delay) || 0);
		state.timers.set(id, { id, due: state.now + ms, fn, args, repeat: repeat ? Math.max(1, ms) : 0, seq: state.seq++ });
		return id;
	};
	w.setTimeout = (fn, delay, ...args) => addTimer(fn, delay, args, false);
	w.setInterval = (fn, delay, ...args) => addTimer(fn, delay, args, true);
	w.clearTimeout = (id) => state.timers.delete(id);
	w.clearInterval = (id) => state.timers.delete(id);
	w.requestAnimationFrame = (cb) => {
		const id = state.nextId++;
		state.rafs.push({ id, cb });
		return id;
	};
	w.cancelAnimationFrame = (id) => {
		state.rafs = state.rafs.filter((r) => r.id !== id);
	};
	w.requestIdleCallback = (cb) => addTimer(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0, [], false);
	w.cancelIdleCallback = (id) => state.timers.delete(id);
	try {
		Object.defineProperty(w.DocumentTimeline.prototype, "currentTime", { get: () => state.now, configurable: true });
	} catch {
		// Older engines without DocumentTimeline: the page's own reads are the only concern.
	}

	let seed = config.seed >>> 0 || 1;
	Math.random = () => {
		seed = (seed + 0x6d2b79f5) >>> 0;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	const NETWORK_APIS = new Set(["WebSocket", "WebTransport", "RTCPeerConnection", "webkitRTCPeerConnection", "EventSource"]);
	const forbid = (name) => {
		const stub = function Forbidden() {
			violation(NETWORK_APIS.has(name) ? "network" : "api", name);
			throw new Error(`lit stage: ${name} is not allowed in a stage page`);
		};
		try {
			Object.defineProperty(w, name, { value: stub, configurable: true, writable: true });
		} catch {
			violation("api", `${name} (could not be stubbed)`);
		}
	};
	for (const name of ["Audio", "AudioContext", "webkitAudioContext", "OfflineAudioContext", "Worker", "SharedWorker", ...NETWORK_APIS]) forbid(name);
	if (w.navigator.serviceWorker) {
		try {
			Object.defineProperty(w.navigator.serviceWorker, "register", { value: () => (violation("api", "serviceWorker.register"), Promise.reject(new Error("lit stage: service workers are not allowed"))), configurable: true });
		} catch {
			violation("api", "serviceWorker (could not be stubbed)");
		}
	}

	const FORBIDDEN_TAGS = new Set(["VIDEO", "AUDIO", "IFRAME", "OBJECT", "EMBED", "FRAME"]);
	const scanNode = (node) => {
		if (node.nodeType !== 1) return;
		if (FORBIDDEN_TAGS.has(node.tagName.toUpperCase())) violation("element", `<${node.tagName.toLowerCase()}>`);
		for (const child of node.querySelectorAll?.("video, audio, iframe, object, embed, frame") ?? []) violation("element", `<${child.tagName.toLowerCase()}>`);
	};
	new MutationObserver((records) => {
		for (const record of records) for (const node of record.addedNodes) scanNode(node);
	}).observe(document, { childList: true, subtree: true });

	const nativeGetContext = w.HTMLCanvasElement.prototype.getContext;
	w.HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
		const context = nativeGetContext.call(this, type, ...rest);
		if (/webgl/iu.test(String(type))) {
			state.webgl ??= { requested: true, ok: true, renderer: null };
			if (!context) state.webgl.ok = false;
			else if (!state.webgl.renderer) {
				const info = context.getExtension("WEBGL_debug_renderer_info");
				state.webgl.renderer = info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
			}
		}
		return context;
	};

	const pump = async () => {
		for (let i = 0; i < 4; i++) await Promise.resolve();
	};
	const live = () => (document.getAnimations ? document.getAnimations() : []);
	const flush = () => {
		getComputedStyle(document.documentElement).getPropertyValue("color");
		document.documentElement.getBoundingClientRect();
	};

	w.__litClock = {
		state,
		/** Before frame 0: every face loaded, every image eager and decoded. */
		async prepare({ faces = [], images = [] } = {}) {
			for (const img of document.images) img.loading = "eager";
			await Promise.all(faces.map((face) => document.fonts.load(face).catch((error) => state.errors.push(`font ${face}: ${error}`))));
			await Promise.all(images.map((src) => {
				const img = new Image();
				img.src = src;
				return img.decode().catch((error) => state.errors.push(`image ${src}: ${error}`));
			}));
			await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
			await document.fonts.ready;
			scanNode(document.documentElement);
			state.loaded = true;
			const stage = w.litStage;
			return stage && typeof stage === "object" ? { defined: true, width: stage.width, height: stage.height, fps: stage.fps ?? 60, duration: stage.duration, hasRender: typeof stage.render === "function" } : { defined: false };
		},
		/** One output frame at t = f / fps, stepped per the renderer's fixed order. */
		async frame(f, { settle = true } = {}) {
			const fps = w.litStage?.fps ?? config.fps;
			const t = f / fps;
			const now = (f * 1000) / fps;
			state.now = now;
			state.texts = [];
			for (const a of live()) {
				const birth = state.anims.get(a);
				if (birth === undefined || state.finished.has(a)) continue;
				const local = (t - birth) * 1000;
				const end = a.effect ? a.effect.getComputedTiming().endTime : Number.POSITIVE_INFINITY;
				if (Number.isFinite(end) && local >= end) {
					state.finished.add(a);
					a.currentTime = end;
					a.finish();
					await pump();
				} else a.currentTime = local;
			}
			for (const svg of document.querySelectorAll("svg")) {
				if (svg.ownerSVGElement || typeof svg.pauseAnimations !== "function") continue;
				if (!state.svgBirth.has(svg)) state.svgBirth.set(svg, f === 0 ? 0 : t);
				svg.pauseAnimations();
				svg.setCurrentTime(Math.max(0, t - state.svgBirth.get(svg)));
			}
			for (let guard = 0; guard < 100000; guard++) {
				let next = null;
				for (const timer of state.timers.values()) if (timer.due <= now + 1e-6 && (!next || timer.due < next.due || (timer.due === next.due && timer.seq < next.seq))) next = timer;
				if (!next) break;
				if (next.repeat) {
					next.due += next.repeat;
					next.seq = state.seq++;
				} else state.timers.delete(next.id);
				try {
					if (typeof next.fn === "function") next.fn(...next.args);
				} catch (error) {
					state.errors.push(`timer: ${error?.stack ?? error}`);
				}
				await pump();
			}
			const rafs = state.rafs;
			state.rafs = [];
			for (const r of rafs) {
				try {
					r.cb(now);
				} catch (error) {
					state.errors.push(`requestAnimationFrame: ${error?.stack ?? error}`);
				}
			}
			await pump();
			const stage = w.litStage;
			if (stage && typeof stage.render === "function") {
				try {
					stage.render(t);
				} catch (error) {
					state.errors.push(`render(${t.toFixed(3)}): ${error?.stack ?? error}`);
				}
			}
			await pump();
			flush();
			for (const a of live()) {
				if (state.anims.has(a)) continue;
				a.pause();
				state.anims.set(a, t);
				a.currentTime = 0;
			}
			flush();
			await document.fonts.ready;
			await Promise.all([...document.images].filter((img) => !img.complete).map((img) => img.decode().catch(() => {})));
			if (settle) await new Promise((resolve) => nativeRaf(() => nativeRaf(resolve)));
			return { violations: state.violations.length, errors: state.errors.length };
		},
		report() {
			return { violations: state.violations, errors: state.errors.slice(0, 20), webgl: state.webgl };
		},
		texts: () => state.texts,
		registerText(entry) {
			state.texts.push(entry);
		},
	};
})(__LIT_STAGE_CONFIG__);
