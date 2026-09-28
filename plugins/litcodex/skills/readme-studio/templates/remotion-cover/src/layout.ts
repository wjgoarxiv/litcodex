export type ReadmeCoverTheme = "light" | "dark";

export function getReadmeCoverLayout(theme: ReadmeCoverTheme, mobile: boolean) {
	const light = theme === "light";
	return {
		titleAsset: `title-outline-${theme}.svg`,
		subtitleAsset: `subtitle-outline-${theme}.svg`,
		microLabelAsset: `micro-label-outline-${theme}.svg`,
		ink: light ? "#15242A" : "#F4F1E9",
		textFieldColor: light ? "#FBF8F0" : "#0C151A",
		textFieldOpacity: 0.98,
		textFieldWidthPercent: mobile ? 100 : 62,
		textFieldHeightPercent: mobile ? 55 : 100,
		mobileArtworkHeightPercent: mobile ? 45 : 0,
		mobileArtworkObjectFit: "cover" as const,
		mobileArtworkObjectPosition: mobile ? "84% center" : "center center",
		artworkStartPercent: mobile ? null : 62,
		sideInsetPx: mobile ? 76 : 126,
		titleLeftPercent: mobile ? 7 : 7.875,
		titleWidthPercent: mobile ? 86 : 50,
		titleHeightPercent: mobile ? 22 : 27,
		titleTopPercent: mobile ? 21 : 29,
		subtitleWidthPercent: mobile ? 76 : 38,
		subtitleMaxHeightPercent: mobile ? 5.5 : 6,
		subtitleBottomPercent: mobile ? 45 : 19,
		microLabelWidthPercent: mobile ? 56 : 32,
		microLabelHeightPercent: mobile ? 3.5 : 3.2,
		microLabelTopPercent: mobile ? 12 : 12,
		separatorWidthPercent: mobile ? 72 : 42,
		separatorBottomPercent: mobile ? 12 : 10,
		frameBorder: light ? "rgba(21,36,42,.42)" : "rgba(244,241,233,.44)",
		accentGlow: light ? "rgba(232,106,74,.16)" : "rgba(169,220,200,.18)",
		separatorColor: light ? "rgba(21,36,42,.6)" : "rgba(244,241,233,.64)",
	};
}
