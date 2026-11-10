// The lit-adhd KPI board, on fixtures only: the two copied Codex sessions (one waits on the user, one still runs),
// a finished plan, a half-done plan, a plan nobody touched for ten days, a handoff note, and a git stand-in that
// reports uncommitted and unpushed work. Nothing here reads the real Codex home.

import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { collectRewind, type GitRunner, renderBrief } from "./rewind.js";
import { boardBar, boardPercent, buildBoard, renderBoard } from "./rewind-board.js";
import { rewindCommand } from "./rewind-cli.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures/rewind/sessions", import.meta.url));
const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const DAY = 86_400_000;

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Scratch {
	readonly home: string;
	readonly codexHome: string;
	readonly workspace: string;
}

function scratch(withSessions = true): Scratch {
	const base = mkdtempSync(join(tmpdir(), "rewind-board-"));
	roots.push(base);
	const home = join(base, "home");
	const codexHome = join(home, ".codex");
	const workspace = join(base, "ws");
	mkdirSync(workspace, { recursive: true });
	mkdirSync(codexHome, { recursive: true });
	if (withSessions) {
		cpSync(FIXTURES, join(codexHome, "sessions"), { recursive: true });
		const day = join(codexHome, "sessions/2026/10/25");
		for (const name of readdirSync(day)) {
			const file = join(day, name);
			writeFileSync(file, readFileSync(file, "utf8").replaceAll("__CWD__", workspace));
			const when = name.includes("aaaaaaaa") ? NOW - 5 * 3_600_000 : NOW - 4 * 60_000;
			utimesSync(file, when / 1000, when / 1000);
		}
	}
	return { home, codexHome, workspace };
}

function plan(workspace: string, file: string, title: string, done: number, total: number, ageMs: number): void {
	const rows = Array.from({ length: total }, (_, i) => `- [${i < done ? "x" : " "}] ${title} task ${i + 1}`);
	mkdirSync(join(workspace, ".litcodex/plans"), { recursive: true });
	const full = join(workspace, ".litcodex/plans", file);
	writeFileSync(full, `# ${title}\n\n## Todos\n\n${rows.join("\n")}\n`);
	const when = (NOW - ageMs) / 1000;
	utimesSync(full, when, when);
}

/** The spec's fixture: two plans (one done, one half), a waiting session, uncommitted changes and a stale plan. */
function fixture(): Scratch {
	const s = scratch();
	plan(s.workspace, "2026-10-24-sync-retry.md", "Sync retry", 3, 3, 2 * 3_600_000);
	plan(s.workspace, "2026-10-25-card-flake.md", "Card flake", 8, 16, 10 * 60_000);
	plan(s.workspace, "2026-10-15-old-docs.md", "Old docs", 1, 4, 10 * DAY);
	writeFileSync(join(s.workspace, "HANDOFF.md"), "# Handoff\n\n## Next\n\n- [ ] write the release note\n");
	return s;
}

const fakeGit =
	(root: string): GitRunner =>
	(_cwd, args) => {
		if (args.includes("--show-toplevel")) return `${root}\n`;
		if (args.includes("--porcelain")) return `worktree ${root}\nHEAD 0000000\nbranch refs/heads/feat/retry\n`;
		if (args.includes("--porcelain=v1")) return "?? notes.md\n M src/sync.ts\n";
		if (args.includes("@{upstream}..HEAD")) return "3\n";
		if (args.includes("--format=%s")) return "Add retry to the sync job\n";
		if (args.includes("--format=%cs%x09%s")) return "2026-10-25\tAdd retry to the sync job\n";
		return null;
	};

const collect = (s: Scratch, git: GitRunner = fakeGit(s.workspace)) =>
	collectRewind({ env: { HOME: s.home, CODEX_HOME: s.codexHome }, cwd: s.workspace, now: NOW, git });

const SECTIONS_EN = [
	"**🎯 Do this now**",
	"**📊 At a glance**",
	"**🏁 Milestones**",
	"**✅ Done lately**",
	"**⬜ Still to do**",
	"**🔔 Don't forget**",
];
const SECTIONS_KO = [
	"**🎯 지금 할 일**",
	"**📊 한눈에 보기**",
	"**🏁 마일스톤**",
	"**✅ 최근 끝낸 일**",
	"**⬜ 남은 일**",
	"**🔔 잊지 말 것**",
];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const RAW_CODES =
	/waiting-on-user|\bidle\b|\bended\b|wait-lanes|start-plan|continue-work|resume-frame|approve-boundary/u;

function sectionBody(board: string, heading: string, next: string | undefined): string[] {
	const lines = board.split("\n");
	const from = lines.findIndex((line) => line.startsWith(heading));
	const to = next === undefined ? lines.length : lines.findIndex((line) => line.startsWith(next));
	return lines.slice(from + 1, to).filter((line) => line.trim() !== "");
}

describe("board bars and percentages", () => {
	it("draws ten cells and never shows a partial total as full or empty", () => {
		expect(boardBar(12, 24)).toBe("█████░░░░░");
		expect(boardBar(11, 11)).toBe("██████████");
		expect(boardBar(3, 10)).toBe("███░░░░░░░");
		expect(boardBar(1, 100)).toBe("█░░░░░░░░░");
		expect(boardBar(99, 100)).toBe("█████████░");
		expect(boardBar(0, 0)).toBe("░░░░░░░░░░");
		expect(boardPercent(12, 24)).toBe(50);
		expect(boardPercent(0, 0)).toBe(0);
	});
});

describe("the KPI board from the collector", () => {
	it("prints the six sections in the fixed order", () => {
		const board = renderBoard(collect(fixture()).kpi, "en");
		const at = SECTIONS_EN.map((heading) => board.split("\n").findIndex((line) => line.startsWith(heading)));
		expect(at.every((index) => index >= 0)).toBe(true);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
		expect(board.split("\n")[0]).toBe(SECTIONS_EN[0]);
		// The Codex terminal prints heading and quote marks literally.
		expect(board).not.toMatch(/^[#>]/mu);
	});

	it("counts the four buckets and the overall bar", () => {
		const { counts } = collect(fixture()).kpi;
		// 3 + 8 ticked rows; the half plan's current row is in progress; the waiting session waits on you; 7 rows left.
		expect(counts).toEqual({ done: 11, doing: 1, waiting: 1, todo: 7, total: 20, percent: 55, bar: "██████░░░░" });
		const board = renderBoard(collect(fixture()).kpi, "en");
		expect(board).toContain("**📊 At a glance** · Overall ██████░░░░ 11/20 (55%)");
		expect(board).toContain("| ✅ done | 🔄 in progress | ⏳ waiting on you | ⬜ left |");
		expect(board).toContain("| 11 | 1 | 1 | 7 |");
	});

	it("draws one milestone row per plan in the window, the plan under way first, and leaves the stale plan out", () => {
		const board = renderBoard(collect(fixture()).kpi, "en");
		const rows = sectionBody(board, SECTIONS_EN[2] ?? "", SECTIONS_EN[3]);
		expect(rows.slice(0, 2)).toEqual(["| Milestone | State | Progress | Last |", "|---|---|---|---|"]);
		expect(rows.slice(2)).toEqual([
			"| Card flake | 🔄 in progress | █████░░░░░ 8/16 | 10m ago |",
			"| Sync retry | ✅ done | ██████████ 3/3 | 2h ago |",
		]);
		expect(board).not.toContain("| Old docs |");
	});

	it("caps done lately at five, newest first, and still-to-do at seven with the rest counted", () => {
		const board = renderBoard(collect(fixture()).kpi, "en");
		const done = sectionBody(board, SECTIONS_EN[3] ?? "", SECTIONS_EN[4]);
		expect(done).toEqual([
			"- Card flake task 8",
			"- Card flake task 7",
			"- Card flake task 6",
			"- Card flake task 5",
			"- Card flake task 4",
		]);
		const left = sectionBody(board, SECTIONS_EN[4] ?? "", SECTIONS_EN[5]);
		expect(left).toHaveLength(8);
		expect(left[0]).toBe("1. Card flake task 9");
		expect(left[6]).toBe("7. Card flake task 15");
		expect(left[7]).toBe("…and 1 more");
		const ko = renderBoard(collect(fixture()).kpi, "ko");
		expect(sectionBody(ko, SECTIONS_KO[4] ?? "", SECTIONS_KO[5]).at(-1)).toBe("…외 1개");
	});

	it("writes reminders as `thing → what to do`, most urgent first, five at most", () => {
		const board = renderBoard(collect(fixture()).kpi, "en");
		const reminders = sectionBody(board, SECTIONS_EN[5] ?? "", undefined);
		expect(reminders).toHaveLength(5);
		for (const line of reminders) expect(line).toMatch(/^- \S+ .+ → .+/u);
		expect(reminders[0]).toMatch(/^- ⏳ The session in ws waits on you: “.+” → open it and answer$/u);
		expect(reminders[1]).toBe("- 💾 2 uncommitted change(s) (ws) → review and commit, or keep them on purpose");
		expect(reminders[2]).toBe("- 📤 3 commit(s) not pushed (ws) → push when ready");
		expect(reminders[3]).toBe("- 🏃 1 lane(s) still working → do not type `go` until they finish");
		expect(reminders[4]).toBe("- 🕰️ Plan stopped 10 days ago: Old docs → decide to continue or drop it");
		const ko = renderBoard(collect(fixture()).kpi, "ko");
		expect(ko).toContain("- 💾 커밋 안 된 변경 2개 (ws) → 확인하고 커밋하거나, 일부러 남겨 두기");
		expect(ko).toContain("- 🕰️ 10일째 멈춘 계획: Old docs → 이어 할지, 접을지 정하기");
	});

	it("keeps a run with parked steps in the running state and reminds about them", () => {
		const s = fixture();
		mkdirSync(join(s.workspace, ".litcodex/start-work"), { recursive: true });
		writeFileSync(
			join(s.workspace, ".litcodex/start-work/state.json"),
			JSON.stringify({
				active_work_id: "w1",
				works: {
					w1: {
						work_id: "w1",
						status: "active",
						active_plan: ".litcodex/plans/2026-10-25-card-flake.md",
						session_ids: ["codex:sess-other"],
						parked_boundaries: [{ boundary_id: "b1" }, { boundary_id: "b2" }],
					},
				},
			}),
		);
		const kpi = collect(s).kpi;
		expect(kpi.milestones.find((item) => item.title === "Card flake")?.state).toBe("doing");
		expect(kpi.counts.waiting).toBe(1);
		expect(kpi.reminders).toContainEqual({ kind: "parked", place: "ws", count: 2 });
		expect(renderBoard(kpi, "en")).toContain(
			"- 🅿️ start-work in ws keeps going with 2 parked step(s) → `lit approve` to allow them (optional), `lit cancel` to end the run",
		);
		expect(renderBoard(kpi, "en")).not.toMatch(/waits for your approval/u);
		expect(renderBoard(kpi, "ko")).toContain("보류된 단계가 2개");
	});

	it("keeps the next-step logic and words it plainly, with what to type or wait for", () => {
		const result = collect(fixture());
		// The running and waiting sessions are lanes of this repo, so the recorded step holds back.
		expect(result.next.kind).toBe("wait-lanes");
		const board = renderBoard(result.kpi, "en").split("\n");
		expect(board[1]).toMatch(/^\*\*Answer the session in ws\*\* — /u);
		expect(board[2]).toBe("👉 Do: open that session and answer it; do not type `go` here yet");
	});

	it("tells the user to type `go` when the step runs on go", () => {
		const s = scratch(false);
		plan(s.workspace, "2026-10-25-card-flake.md", "Card flake", 2, 5, 60_000);
		const result = collect(s, () => null);
		expect(result.next.kind).toBe("start-plan");
		const board = renderBoard(result.kpi, "en").split("\n");
		expect(board[1]).toBe("**Start Card flake** — it is the only open plan here (2 of 5 done)");
		expect(board[2]).toBe("👉 Type: `go`");
		expect(renderBoard(result.kpi, "ko").split("\n")[2]).toBe("👉 입력: `go`");
	});

	it("shows no session id, UUID, commit hash, plan file name or raw status code", () => {
		const result = collect(fixture());
		for (const lang of ["en", "ko"] as const) {
			const board = renderBoard(result.kpi, lang);
			expect(board).not.toMatch(UUID);
			expect(board).not.toMatch(/aaaaaaaa|bbbbbbbb/u);
			expect(board).not.toMatch(/\b[0-9a-f]{7,40}\b/u);
			expect(board).not.toMatch(/\.md\b|\.litcodex|2026-10-2\d-/u);
			expect(board).not.toMatch(RAW_CODES);
		}
	});

	it("stays within about forty lines on the full fixture", () => {
		for (const lang of ["en", "ko"] as const) {
			expect(renderBoard(collect(fixture()).kpi, lang).split("\n").length).toBeLessThanOrEqual(40);
		}
	});

	it("prints one plain line for every empty section", () => {
		const s = scratch(false);
		const board = renderBoard(collect(s, () => null).kpi, "en");
		expect(board).toContain("No milestones yet");
		expect(board).toContain("Nothing finished yet");
		expect(board).toContain("Nothing left");
		expect(board).toContain("Nothing to remember");
		expect(board).toContain("Overall nothing tracked yet");
		const ko = renderBoard(collect(s, () => null).kpi, "ko");
		for (const line of [
			"아직 마일스톤이 없어요",
			"아직 끝낸 일이 없어요",
			"남은 일이 없어요",
			"잊을 만한 일이 없어요",
		])
			expect(ko).toContain(line);
	});

	it("keeps record text inert inside the board", () => {
		const s = scratch(false);
		plan(s.workspace, "2026-10-25-x.md", "Pipe | and `code` *bold*", 1, 2, 60_000);
		const board = renderBoard(collect(s, () => null).kpi, "en");
		expect(board).toContain("Pipe \\| and 'code' \\*bold\\*");
		expect(board).not.toContain("`code`");
	});

	it("is deterministic: the same records give the same board", () => {
		const s = fixture();
		expect(renderBoard(collect(s).kpi, "ko")).toBe(renderBoard(collect(s).kpi, "ko"));
		const again = buildBoard({
			now: NOW,
			step: { kind: "nothing" },
			trees: [],
			waiting: [],
			working: 0,
			unknown: [],
		});
		expect(again.take).toBe("do");
	});
});

describe("the rewind command shows the board, and the detail list only on request", () => {
	const run = (s: Scratch, argv: string[]): { out: string; code: number } => {
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		let out = "";
		stdout.on("data", (chunk) => {
			out += String(chunk);
		});
		const code = rewindCommand(argv, {
			stdout,
			stderr,
			cwd: s.workspace,
			env: { HOME: s.home, CODEX_HOME: s.codexHome },
			now: NOW,
		});
		return { out, code };
	};

	it("prints the board by default, without the per-session cards", () => {
		const s = fixture();
		const { out, code } = run(s, []);
		expect(code).toBe(0);
		expect(out.startsWith("**🎯 Do this now**")).toBe(true);
		expect(out).not.toContain("Recommended next step");
		expect(out).not.toContain("Ended ·");
	});

	it("puts the detail list under the board on `--detail`", () => {
		const s = fixture();
		const { out } = run(s, ["--detail", "--lang", "ko"]);
		const board = out.indexOf("**🎯 지금 할 일**");
		const detail = out.indexOf("Recommended next step");
		expect(board).toBe(0);
		expect(detail).toBeGreaterThan(board);
	});

	it("emits the ready board text and its structured fields in the JSON, the detail only on request", () => {
		const s = fixture();
		const plain = JSON.parse(run(s, ["--json", "--lang", "ko"]).out) as Record<string, unknown>;
		expect(typeof plain["board"]).toBe("string");
		expect(String(plain["board"]).startsWith("**🎯 지금 할 일**")).toBe(true);
		expect(plain["kpi"]).toMatchObject({ counts: { done: 11, total: 20 } });
		expect(plain["detail"]).toBeUndefined();
		expect(plain["brief"]).toBeUndefined();
		const detailed = JSON.parse(run(s, ["--json", "--detail"]).out) as Record<string, unknown>;
		expect(String(detailed["detail"])).toContain("Recommended next step");
		expect(renderBrief(collect(s, () => null))).toContain("Recommended next step");
	});

	it("refuses an unknown language instead of guessing", () => {
		const { code } = run(scratch(false), ["--lang", "fr"]);
		expect(code).toBe(2);
	});
});
