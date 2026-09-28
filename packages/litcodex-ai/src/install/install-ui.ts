import { amber, CLEAR_LINE, dim, green, red } from "../ui-style.js";
import type { InstallPreflightStage, InstallStepKind } from "./types.js";

const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const SPINNER_INTERVAL_MS = 80;

export interface SpinnerMotion {
	readonly start: (label: string) => () => void;
}

export class Spinner {
	private readonly stream: NodeJS.WritableStream;
	private readonly color: boolean;
	private timer: ReturnType<typeof setInterval> | null = null;
	private frameIndex = 0;
	private label = "";
	private readonly motion: SpinnerMotion | undefined;
	private stopMotion: (() => void) | null = null;

	constructor(stream: NodeJS.WritableStream, color: boolean, motion?: SpinnerMotion) {
		this.stream = stream;
		this.color = color;
		this.motion = motion;
	}

	start(label: string): void {
		this.clearTimer();
		this.clearMotion();
		this.label = label;
		if (!this.color) return;
		if (this.motion !== undefined) {
			this.stopMotion = this.motion.start(label);
			return;
		}
		this.frameIndex = 0;
		this.render();
		this.timer = setInterval(() => {
			this.frameIndex = (this.frameIndex + 1) % BRAILLE_FRAMES.length;
			this.render();
		}, SPINNER_INTERVAL_MS);
	}

	succeed(label?: string): void {
		this.finish(label ?? this.label, "ok");
	}

	fail(label?: string): void {
		this.finish(label ?? this.label, "failed");
	}

	skip(label?: string): void {
		this.finish(label ?? this.label, "skipped");
	}

	stop(): void {
		this.clearTimer();
		this.clearMotion();
		if (this.color) this.stream.write(CLEAR_LINE);
	}

	private render(): void {
		const frame = amber(BRAILLE_FRAMES[this.frameIndex] ?? BRAILLE_FRAMES[0], this.color);
		this.stream.write(`${CLEAR_LINE}  ${frame} ${this.label}`);
	}

	private finish(label: string, status: "ok" | "failed" | "skipped"): void {
		this.clearTimer();
		this.clearMotion();
		if (this.color) this.stream.write(`${CLEAR_LINE}  ${statusIcon(status, true)} ${label}\n`);
		else this.stream.write(`${statusIcon(status, false)} ${label}\n`);
	}

	private clearTimer(): void {
		if (this.timer === null) return;
		clearInterval(this.timer);
		this.timer = null;
	}

	private clearMotion(): void {
		if (this.stopMotion === null) return;
		this.stopMotion();
		this.stopMotion = null;
	}
}

function statusIcon(status: "ok" | "failed" | "skipped", color: boolean): string {
	if (color) {
		switch (status) {
			case "ok":
				return green("✓", true);
			case "failed":
				return red("✗", true);
			case "skipped":
				return dim("○", true);
		}
	}
	switch (status) {
		case "ok":
			return "[ok]";
		case "failed":
			return "[fail]";
		case "skipped":
			return "[skip]";
	}
}

const STEP_LABELS: Readonly<Record<InstallStepKind, string>> = {
	"marketplace-add": "Registering marketplace",
	"plugin-add": "Installing plugin",
	"hooks-register": "Wiring UserPromptSubmit hook",
	"agents-install": "Installing litwork agents",
	"config-update": "Updating Codex config",
	verify: "Running doctor",
};

export function humanLabel(kind: InstallStepKind): string {
	return STEP_LABELS[kind];
}

const PREFLIGHT_LABELS: Readonly<Record<InstallPreflightStage, string>> = {
	"host-capabilities": "[1/3] Inspecting Codex host capabilities",
	"config-dry-run": "[2/3] Validating managed config (read-only)",
	"marketplace-payload": "[3/3] Preparing bundled marketplace payload",
};

export function preflightLabel(stage: InstallPreflightStage): string {
	return PREFLIGHT_LABELS[stage];
}
