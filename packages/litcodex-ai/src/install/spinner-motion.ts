import { Worker } from "node:worker_threads";

import type { SpinnerMotion } from "./install-ui.js";

const MOTION_WORKER_SOURCE = String.raw`
const { writeSync } = require("node:fs");
const { workerData } = require("node:worker_threads");
const frames = workerData.look.frames;
const state = new Int32Array(workerData.state);
let frameIndex = 0;
let timer;

function stopIfRequested() {
  if (Atomics.load(state, 0) !== 2) return false;
  if (timer !== undefined) clearInterval(timer);
  process.exit(0);
}

function render() {
  if (stopIfRequested()) return;
  if (Atomics.compareExchange(state, 0, 0, 1) !== 0) return;
  try {
    const frame = frames[frameIndex] ?? frames[0];
    writeSync(workerData.fd, "\r\u001b[2K" + workerData.look.before + frame + workerData.look.after + workerData.label);
    frameIndex = (frameIndex + 1) % frames.length;
  } finally {
    Atomics.store(state, 0, 0);
    Atomics.notify(state, 0);
  }
}

render();
timer = setInterval(render, 80);
`;

/** The live row around the label: what precedes the frame, what follows it, and the frames themselves. */
export interface SpinnerMotionLook {
	readonly before: string;
	readonly after: string;
	readonly frames: readonly string[];
}

const DEFAULT_LOOK: SpinnerMotionLook = {
	before: "  \u001b[38;2;255;176;32m",
	after: "\u001b[39m ",
	frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
};

export function createBlockingSpinnerMotion(fd: number, look: SpinnerMotionLook = DEFAULT_LOOK): SpinnerMotion {
	return {
		start(label) {
			const state = new Int32Array(new SharedArrayBuffer(4));
			const worker = new Worker(MOTION_WORKER_SOURCE, {
				eval: true,
				workerData: { fd, label, look, state: state.buffer },
			});
			worker.unref();
			return () => stopMotion(state);
		},
	};
}

function stopMotion(state: Int32Array): void {
	while (Atomics.compareExchange(state, 0, 0, 2) !== 0) {
		if (Atomics.load(state, 0) === 2) return;
		Atomics.wait(state, 0, 1, 50);
	}
}
