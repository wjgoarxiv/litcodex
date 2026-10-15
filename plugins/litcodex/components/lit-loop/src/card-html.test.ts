// The LIT card's own script, run against a small scripted host: a fake DOM, fake timers and either host
// bridge (`window.openai`, or MCP Apps JSON-RPC over postMessage). No browser is involved; the rendered
// look is checked separately in a real browser.
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CARD_HTML } from "./card-html.js";

type Listener = (event: unknown) => void;

class FakeText {
	parent: FakeElement | null = null;
	constructor(public text: string) {}
	get textContent(): string {
		return this.text;
	}
}

class FakeElement {
	parent: FakeElement | null = null;
	childNodes: (FakeElement | FakeText)[] = [];
	className = "";
	readonly attributes = new Map<string, string>();
	readonly style: Record<string, unknown> & { setProperty: (name: string, value: string) => void };
	readonly classList = {
		toggle: (name: string, force?: boolean): boolean => {
			const names = new Set(this.className.split(/\s+/u).filter(Boolean));
			const on = force ?? !names.has(name);
			if (on) names.add(name);
			else names.delete(name);
			this.className = [...names].join(" ");
			return on;
		},
		contains: (name: string): boolean => this.className.split(/\s+/u).includes(name),
	};
	constructor(
		public readonly tagName: string,
		private readonly measure: (element: FakeElement) => number,
	) {
		const props: Record<string, string> = {};
		this.style = { setProperty: (name: string, value: string) => (props[name] = value) };
	}
	get textContent(): string {
		return this.childNodes.map((child) => child.textContent).join("");
	}
	set textContent(value: string) {
		this.childNodes = [];
		if (value !== "") this.appendChild(new FakeText(value));
	}
	get lastChild(): FakeElement | FakeText | null {
		return this.childNodes.at(-1) ?? null;
	}
	get children(): FakeElement[] {
		return this.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
	}
	appendChild<T extends FakeElement | FakeText>(child: T): T {
		child.parent = this;
		this.childNodes.push(child);
		return child;
	}
	removeChild<T extends FakeElement | FakeText>(child: T): T {
		this.childNodes = this.childNodes.filter((node) => node !== child);
		return child;
	}
	setAttribute(name: string, value: string): void {
		if (name === "class") this.className = value;
		else this.attributes.set(name, value);
	}
	getAttribute(name: string): string | null {
		return this.attributes.get(name) ?? null;
	}
	matches(selector: string): boolean {
		if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
		const attr = selector.match(/^\[([\w-]+)\]$/u)?.[1];
		return attr !== undefined && this.attributes.has(attr);
	}
	querySelectorAll(selector: string): FakeElement[] {
		const found: FakeElement[] = [];
		const walk = (node: FakeElement): void => {
			for (const child of node.children) {
				if (child.matches(selector)) found.push(child);
				walk(child);
			}
		};
		walk(this);
		return found;
	}
	querySelector(selector: string): FakeElement | null {
		return this.querySelectorAll(selector)[0] ?? null;
	}
	getBoundingClientRect(): { height: number } {
		return { height: this.measure(this) };
	}
	get scrollWidth(): number {
		return 0;
	}
	get clientWidth(): number {
		return 0;
	}
}

/** The CSS custom properties of `:root` and `:root.light`, read from the card's own stylesheet. */
function tokens(selector: string): Record<string, string> {
	const escaped = selector.replace(/\./gu, "\\.");
	const body = CARD_HTML.match(new RegExp(`\\n${escaped}\\{([^}]*)\\}`, "u"))?.[1] ?? "";
	const out: Record<string, string> = {};
	for (const match of body.matchAll(/(--[\w-]+):([^;]+)/gu)) out[match[1] ?? ""] = (match[2] ?? "").trim();
	return out;
}
const DARK = tokens(":root");
const LIGHT = { ...DARK, ...tokens(":root.light") };

interface HostOptions {
	readonly bridge: "mcp" | "openai";
	readonly theme?: "dark" | "light";
	/** What the card's instantiating tool call returned; delivered as `toolOutput` or `tool-result`. */
	readonly toolResult?: Record<string, unknown>;
	/** The status every poll answers with; tests swap it between polls. */
	poll: Record<string, unknown>;
	readonly now: number;
}

/** Boot the card script against a scripted host and return handles to drive and read it. */
function bootCard(options: HostOptions) {
	let now = options.now;
	let nextTimer = 1;
	const timers = new Map<number, { at: number; fn: () => void; every: number | null }>();
	const listeners = new Map<string, Listener[]>();
	const docListeners = new Map<string, Listener[]>();
	const posted: Record<string, unknown>[] = [];
	const heights: number[] = [];
	const calls: string[] = [];
	const measure = (element: FakeElement): number =>
		element.classList.contains("folded") ? 28 : 22 + 22 * element.children.length;
	const root = new FakeElement("html", measure);
	const card = new FakeElement("div", measure);
	card.className = "lc is-idle";
	const parent = {
		postMessage(message: Record<string, unknown>) {
			posted.push(message);
			if (message["method"] === "ui/notifications/size-changed") {
				heights.push(Number((message["params"] as { height: number }).height));
			}
			if (message["id"] === undefined) return;
			const reply = (result: unknown) =>
				queueMicrotask(() =>
					dispatch("message", { source: parent, data: { jsonrpc: "2.0", id: message["id"], result } }),
				);
			if (message["method"] === "ui/initialize") {
				reply({ hostContext: { displayMode: "inline", theme: options.theme ?? "dark" } });
				if (options.toolResult) {
					const params = { structuredContent: options.toolResult };
					queueMicrotask(() =>
						dispatch("message", {
							source: parent,
							data: { jsonrpc: "2.0", method: "ui/notifications/tool-result", params },
						}),
					);
				}
			} else if (message["method"] === "tools/call") {
				calls.push(String((message["params"] as { name: string }).name));
				reply({ structuredContent: { ...options.poll } });
			}
		},
	};
	function dispatch(type: string, event: unknown): void {
		for (const listener of listeners.get(type) ?? []) listener(event);
	}
	const document = {
		hidden: false,
		documentElement: root,
		getElementById: (id: string) => (id === "card" ? card : null),
		createElement: (tag: string) => new FakeElement(tag, measure),
		createElementNS: (_ns: string, tag: string) => new FakeElement(tag, measure),
		createTextNode: (text: string) => new FakeText(text),
		addEventListener: (type: string, listener: Listener) =>
			docListeners.set(type, [...(docListeners.get(type) ?? []), listener]),
	};
	const context: Record<string, unknown> = {
		document,
		Date: { now: () => now },
		getComputedStyle: () => ({
			getPropertyValue: (name: string) => (root.classList.contains("light") ? LIGHT : DARK)[name] ?? "",
		}),
		setTimeout: (fn: () => void, ms: number) => {
			const id = nextTimer++;
			timers.set(id, { at: now + ms, fn, every: null });
			return id;
		},
		setInterval: (fn: () => void, ms: number) => {
			const id = nextTimer++;
			timers.set(id, { at: now + ms, fn, every: ms });
			return id;
		},
		clearTimeout: (id: number) => timers.delete(id),
		clearInterval: (id: number) => timers.delete(id),
		addEventListener: (type: string, listener: Listener) =>
			listeners.set(type, [...(listeners.get(type) ?? []), listener]),
		matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
		parent,
	};
	if (options.bridge === "openai") {
		context["openai"] = {
			theme: options.theme ?? "dark",
			displayMode: "inline",
			toolOutput: options.toolResult ?? null,
			callTool: (name: string) => {
				calls.push(name);
				return Promise.resolve({ structuredContent: { ...options.poll } });
			},
			notifyIntrinsicHeight: (height: number) => heights.push(height),
		};
	}
	context["window"] = context;
	createContext(context);
	const script = CARD_HTML.match(/<script>([\s\S]*)<\/script>/u)?.[1] ?? "";
	runInContext(script, context);

	const settle = async (): Promise<void> => {
		for (let i = 0; i < 20; i++) await Promise.resolve();
	};
	return {
		card,
		root,
		calls,
		heights,
		posted,
		timers,
		settle,
		text: () => card.textContent,
		/** What every later poll answers with. */
		setPoll(status: Record<string, unknown>): void {
			options.poll = status;
		},
		right: () => card.querySelector(".right"),
		/** Move the clock forward, firing every due timer in order and letting each reply land. */
		async advance(ms: number): Promise<void> {
			const end = now + ms;
			await settle();
			for (;;) {
				const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
				if (due === undefined) break;
				const [id, timer] = due;
				now = timer.at;
				if (timer.every === null) timers.delete(id);
				else timer.at += timer.every;
				timer.fn();
				await settle();
			}
			now = end;
		},
		fire(type: "resize" | "visibilitychange"): void {
			if (type === "resize") dispatch("resize", {});
			else for (const listener of docListeners.get(type) ?? []) listener({});
		},
	};
}

const T0 = 1_000_000;

function working(extra: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		version: 1,
		thread: "t1",
		state: "ignited",
		mode: "lit-loop",
		ignitedAt: T0 - 60_000,
		map: {
			family: "main",
			cells: [
				{ key: "work", word: "work", state: "current", label: null, progress: null },
				{ key: "review", word: "review", state: "pending", label: null, progress: null },
				{ key: "done", word: "done", state: "pending", label: null, progress: null },
			],
			next: null,
		},
		step: { tool: "Bash", startedAt: T0 - 3_000 },
		lastStepAt: T0 - 3_000,
		lastTool: null,
		turnStartedAt: T0 - 42_000,
		turnEndedAt: null,
		working: true,
		usage: { ctx: 17, fiveHour: 75, week: 95 },
		branch: "master",
		workspace: "demo",
		cardOpenedAt: T0 - 5_000,
		now: T0,
		...extra,
	};
}

function complete(extra: Record<string, unknown> = {}): Record<string, unknown> {
	return working({
		state: "complete",
		step: null,
		working: false,
		turnStartedAt: T0 - 49_000,
		turnEndedAt: T0,
		map: {
			family: "main",
			cells: [
				{ key: "work", word: "work", state: "done", label: null, progress: null },
				{ key: "review", word: "review", state: "done", label: null, progress: null },
				{ key: "done", word: "done", state: "done", label: null, progress: null },
			],
			next: null,
		},
		...extra,
	});
}

describe("LIT card script", () => {
	it("shows the turn clock on the right instead of repeating the stage word, with the live dot", async () => {
		const host = bootCard({ bridge: "mcp", poll: working(), now: T0 });
		await host.advance(0);
		const right = host.right();
		expect(right?.textContent).toBe("0:42");
		expect(right?.textContent).not.toMatch(/WORK/u);
		expect(right?.querySelector(".dot")).not.toBeNull();
		await host.advance(3_000);
		expect(host.right()?.textContent).toBe("0:45");
	});

	it("keeps the step clock moving between polls", async () => {
		const host = bootCard({ bridge: "mcp", poll: working(), now: T0 });
		await host.advance(0);
		expect(host.text()).toContain("Bash· 0:03");
		await host.advance(1_000);
		expect(host.text()).toContain("Bash· 0:04");
	});

	it("says DONE ✓ when complete, idle when ready, and IGNITED only when there is no map", async () => {
		const done = bootCard({ bridge: "mcp", poll: complete(), now: T0 });
		await done.advance(0);
		expect(done.right()?.textContent).toBe("DONE ✓");
		const ready = bootCard({ bridge: "mcp", poll: { ...working(), state: "ready", map: null, mode: null }, now: T0 });
		await ready.advance(0);
		expect(ready.right()?.textContent).toBe("idle");
		const bare = bootCard({ bridge: "mcp", poll: working({ map: null, working: false, step: null }), now: T0 });
		await bare.advance(0);
		expect(bare.right()?.textContent).toBe("IGNITED");
		const waiting = bootCard({ bridge: "mcp", poll: working({ working: false, step: null }), now: T0 });
		await waiting.advance(0);
		expect(waiting.right()?.textContent ?? "").not.toMatch(/WORK|IGNITED/u);
	});

	it("draws usage in a calm accent below 70 %, amber from 70 % and red from 90 %", async () => {
		for (const theme of ["dark", "light"] as const) {
			const host = bootCard({ bridge: "mcp", theme, poll: working(), now: T0 });
			await host.advance(0);
			const palette = theme === "light" ? LIGHT : DARK;
			const [ctx, five, week] = host.card.querySelectorAll(".mini");
			const lit = (bar: FakeElement | undefined) =>
				(bar?.children ?? []).map((cell) => cell.style["background"]).filter(Boolean);
			expect(lit(ctx)).toEqual([palette["--acc"], palette["--acc"]]);
			expect(new Set(lit(five))).toEqual(new Set([palette["--amber"]]));
			expect(new Set(lit(week))).toEqual(new Set([palette["--red"]]));
		}
	});

	it("folds into one quiet line and stops polling once a newer card opens (MCP Apps bridge)", async () => {
		const opened = T0 - 5_000;
		const host = bootCard({
			bridge: "mcp",
			toolResult: { ...working(), card: { openedAt: opened } },
			poll: working({ cardOpenedAt: opened }),
			now: T0,
		});
		await host.advance(0);
		await host.advance(1_500);
		expect(host.card.classList.contains("folded")).toBe(false);
		const tallest = Math.max(...host.heights);
		host.setPoll(working({ cardOpenedAt: T0 + 2_000, turnStartedAt: T0 + 1_000 }));
		await host.advance(1_500);
		expect(host.card.classList.contains("folded")).toBe(true);
		expect(host.card.children).toHaveLength(1);
		expect(host.text()).toContain("lit-loop");
		expect(host.text()).toContain("continued below ↓");
		expect(host.heights.at(-1)).toBeLessThan(tallest);
		const polls = host.calls.length;
		await host.advance(120_000);
		host.fire("visibilitychange");
		host.fire("resize");
		await host.advance(120_000);
		expect(host.calls).toHaveLength(polls);
		expect(host.timers.size).toBe(0);
	});

	it("folds a finished card to its result and reports the new height (window.openai bridge)", async () => {
		const opened = T0 - 50_000;
		const host = bootCard({
			bridge: "openai",
			theme: "light",
			toolResult: { ...complete({ cardOpenedAt: opened }), card: { openedAt: opened } },
			poll: complete({ cardOpenedAt: opened }),
			now: T0,
		});
		await host.advance(0);
		expect(host.right()?.textContent).toBe("DONE ✓");
		const tallest = Math.max(...host.heights);
		host.setPoll(working({ cardOpenedAt: T0 + 3_000 }));
		await host.advance(5_000);
		expect(host.card.classList.contains("folded")).toBe(true);
		expect(host.text()).toContain("done ✓ 49s");
		expect(host.heights.at(-1)).toBeLessThan(tallest);
		const polls = host.calls.length;
		await host.advance(300_000);
		expect(host.calls).toHaveLength(polls);
	});

	it("takes its own opening time only from the tool result, so a card from before the change keeps working", async () => {
		const host = bootCard({ bridge: "mcp", poll: working({ cardOpenedAt: T0 - 5_000 }), now: T0 });
		await host.advance(0);
		host.setPoll(working({ cardOpenedAt: T0 + 9_000 }));
		await host.advance(1_500);
		expect(host.card.classList.contains("folded")).toBe(false);
		const polls = host.calls.length;
		await host.advance(1_500);
		expect(host.calls.length).toBeGreaterThan(polls);
	});
});
