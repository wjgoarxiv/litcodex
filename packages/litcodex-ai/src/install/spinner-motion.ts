import { Worker } from "node:worker_threads";

import type { SpinnerMotion } from "./install-ui.js";

const MOTION_WORKER_SOURCE = String.raw`
const { writeSync } = require("node:fs");
const { workerData } = require("node:worker_threads");
const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
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
    writeSync(workerData.fd, "\r\u001b[2K  \u001b[38;2;255;176;32m" + frame + "\u001b[39m " + workerData.label);
    frameIndex = (frameIndex + 1) % frames.length;
  } finally {
    Atomics.store(state, 0, 0);
    Atomics.notify(state, 0);
  }
}

render();
timer = setInterval(render, 80);
`;

export function createBlockingSpinnerMotion(fd: number): SpinnerMotion {
	return {
		start(label) {
			const state = new Int32Array(new SharedArrayBuffer(4));
			const worker = new Worker(MOTION_WORKER_SOURCE, {
				eval: true,
				workerData: { fd, label, state: state.buffer },
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
