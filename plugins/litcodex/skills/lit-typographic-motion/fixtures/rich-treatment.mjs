// A complete rich stage treatment for an explainer request, shared by the validator tests (fixtures/
// never ships). The request names no style, so the genre picks paper; it asks for no calm, so the
// register is rich: a world, a score and on-screen events are all required and all present.
export const RICH_REQUEST = "make a short explainer video about how a rain garden filters street runoff lit";

export function richStage() {
	return {
		request: RICH_REQUEST,
		genre: "explainer",
		path: "stage",
		pathReason: "the film shows water moving through soil layers, which needs drawn shapes",
		style: "paper",
		idea: "Follow one raindrop from a curb cut down through mulch, sand and roots until it reaches clean groundwater.",
		audience: "neighbours deciding whether to plant a rain garden",
		channel: "community newsletter embed, played with sound",
		format: "16:9",
		formatReason: "the newsletter player is landscape",
		durationSec: 16,
		subject: { name: "Maple Street rain garden", source: "invented", specifics: ["a planted dip beside the curb that catches runoff", "three soil layers under native sedges", "built by the block association"] },
		story: {
			expect: "A drain takes the rain and that is the end of it.",
			turn: "The droplet comes out the bottom clear while the oil stays behind in the mulch.",
			beat: 2,
			payoff: "The garden at street level looks like any flowerbed and does that work every storm.",
		},
		protagonist: {
			name: "the droplet",
			kind: "object",
			look: "a rounded rust-red drop, a tenth of the frame tall, that turns clear as it falls",
			acts: [
				{ beat: 0, action: "falls from the curb cut into the drain mouth" },
				{ beat: 1, action: "slides through mulch, sand and roots" },
				{ beat: 2, action: "drops out the bottom clear" },
				{ beat: 3, action: "rests in the groundwater under the garden" },
			],
		},
		beats: [
			{ t0: 0, t1: 4, purpose: "question", onScreen: "a storm drain swallowing oily water", motion: "rain streaks fall, the drain gulps", sound: "low pulse, a hit on the cut", layout: "title", hero: "the drain mouth swallows the first drop", transition: "wipe" },
			{ t0: 4, t1: 8, purpose: "steps", onScreen: "cross-section of mulch, sand and roots", motion: "layers slide in from below", sound: "rise into the change", layout: "split", hero: "the droplet slides down through the layers", transition: "match" },
			{ t0: 8, t1: 12, purpose: "result", onScreen: "the droplet turning clear at the bottom", motion: "a mask wipe follows the droplet", sound: "pad opens", layout: "hero", hero: "the droplet clears as it leaves the sand", transition: "push" },
			{ t0: 12, t1: 16, purpose: "recap", onScreen: "the garden at street level with a label", motion: "match cut back to the curb", sound: "closing cadence", layout: "stage", hero: "the camera lifts to the street", transition: "end" },
		],
		world: {
			layers: ["sky and rain streaks", "the street and curb cut", "the planted dip with mulch", "soil layers under the dip", "groundwater at the bottom"],
			labels: ["curb cut", "mulch", "sand", "roots", "clean water", "storm drain"],
			camera: [
				{ beat: 0, move: "slow push-in on the drain mouth" },
				{ beat: 2, move: "crane down with the droplet" },
				{ beat: 3, move: "pull back to street level" },
			],
		},
		visualDevices: [
			{ kind: "illustration", role: "subject", beats: [0, 1, 2, 3] },
			{ kind: "diagram", role: "support", beats: [1, 2] },
			{ kind: "particles", role: "texture", beats: [0] },
		],
		typePlan: { faces: ["Pretendard", "JetBrains Mono"], hierarchy: "one short label per beat, the recap line largest", maxWordsOnScreen: 7 },
		palette: [
			{ hex: "#F3EEE5", role: "paper ground" },
			{ hex: "#1D1B18", role: "label ink" },
			{ hex: "#B0452A", role: "the droplet" },
			{ hex: "#3F7D3A", role: "living roots" },
		],
		sound: {
			mode: "score",
			plan: "a house groove that opens up as the water clears and drops out on the turn",
			events: [
				{ t: 2, on: "the drain mouth gulps the first drop", kind: "hit" },
				{ t: 6, on: "the droplet passes through the sand layer", kind: "whoosh" },
				{ t: 10, on: "the droplet turns clear at the bottom", kind: "chime" },
			],
		},
		copy: { source: "invented", lines: ["Where does the storm go?", "Mulch, sand, roots", "Clear water below", "Maple Street, block 4"] },
		inventions: ["Maple Street rain garden", "built by the block association", "all four copy lines"],
		ambition: "Every cut should be a match cut on the droplet, with the soil layers drawn in depth so the filtering reads without words.",
	};
}
