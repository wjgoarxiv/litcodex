import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { getReadmeCoverLayout } from "./layout";
import { coverLoopProgress, titleMotionAt } from "./motion";
import type { ReadmeCoverProps } from "./Root";

const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };

export const ReadmeCover = ({ theme, mobile }: ReadmeCoverProps) => {
	const frame = useCurrentFrame();
	const progress = coverLoopProgress(frame);
	const titleMotion = titleMotionAt(frame);
	const backgroundScale = interpolate(progress, [0, 1], [1.035, 1.075], clamp);
	const glowOpacity = interpolate(progress, [0, 1], [0.34, 0.52], clamp);
	const rimOpacity = interpolate(progress, [0, 1], [0.16, 0.3], clamp);
	const layout = getReadmeCoverLayout(theme, mobile);
	const light = theme === "light";
	const field = mobile ? layout.textFieldColor : `linear-gradient(90deg, ${layout.textFieldColor} 0%, ${layout.textFieldColor} 88%, transparent 100%)`;
	const focalMask = mobile
		? "linear-gradient(180deg, transparent 44%, rgba(0,0,0,.55) 56%, #000 68%)"
		: "linear-gradient(90deg, transparent 47%, rgba(0,0,0,.55) 58%, #000 67%)";
	const rimColor = light ? "rgba(232,106,74,.34)" : "rgba(169,220,200,.42)";

	return (
		<AbsoluteFill style={{ backgroundColor: light ? "#F4F1E9" : "#10191E", color: layout.ink, overflow: "hidden" }}>
				<Img
					id="depth-background"
					src={staticFile("cover-background.png")}
					alt=""
					style={{ position: "absolute", left: "-4%", top: "-4%", width: "108%", height: "108%", objectFit: "cover", objectPosition: mobile ? layout.mobileArtworkObjectPosition : "center center", filter: "blur(18px)", scale: backgroundScale * 1.02 }}
				/>
				<Img
					id="focal-plane"
					src={staticFile("cover-background.png")}
					alt=""
					style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: layout.mobileArtworkObjectFit, objectPosition: mobile ? layout.mobileArtworkObjectPosition : "center center", scale: backgroundScale, maskImage: focalMask, WebkitMaskImage: focalMask }}
				/>
				<AbsoluteFill style={{ background: `linear-gradient(115deg, ${light ? "rgba(251,248,240,.14)" : "rgba(8,17,22,.16)"} 0%, transparent 58%, ${light ? "rgba(232,106,74,.10)" : "rgba(169,220,200,.10)"} 100%)` }} />
				<AbsoluteFill
					id="rim-light"
					style={{
						pointerEvents: "none",
						background: mobile
							? `linear-gradient(180deg, transparent 58%, ${rimColor} 62%, transparent 72%), radial-gradient(ellipse at 88% 96%, ${rimColor} 0%, transparent 48%)`
							: `linear-gradient(90deg, transparent 53%, ${rimColor} 60%, transparent 68%), radial-gradient(ellipse at 94% 18%, ${rimColor} 0%, transparent 48%)`,
						opacity: rimOpacity,
						mixBlendMode: light ? "soft-light" : "screen",
					}}
				/>
			<div style={{ position: "absolute", top: 0, left: 0, width: `${layout.textFieldWidthPercent}%`, height: `${layout.textFieldHeightPercent}%`, background: field, opacity: layout.textFieldOpacity, pointerEvents: "none" }} />
			<div
				style={{
					position: "absolute",
					width: mobile ? 470 : 620,
					height: mobile ? 470 : 620,
					top: mobile ? "6%" : "-12%",
					right: mobile ? "-14%" : "-4%",
					borderRadius: "50%",
					background: layout.accentGlow,
					filter: "blur(82px)",
					opacity: glowOpacity,
				}}
			/>
			<div
				style={{
					position: "absolute",
					inset: layout.sideInsetPx,
					border: `1px solid ${layout.frameBorder}`,
					transform: mobile ? "none" : "perspective(1200px) rotateY(-3deg)",
				}}
			/>
			<Img
				src={staticFile(layout.microLabelAsset)}
				alt=""
				style={{ position: "absolute", left: layout.sideInsetPx, top: `${layout.microLabelTopPercent}%`, width: `${layout.microLabelWidthPercent}%`, height: `${layout.microLabelHeightPercent}%`, objectFit: "contain", objectPosition: "left center" }}
			/>
			<Img
				src={staticFile(layout.titleAsset)}
				alt=""
				style={{ position: "absolute", top: `${layout.titleTopPercent}%`, left: layout.sideInsetPx, width: `${layout.titleWidthPercent}%`, height: `${layout.titleHeightPercent}%`, objectFit: "contain", objectPosition: "left center", translate: `0px ${titleMotion.titleOffsetY}px` }}
			/>
			<Img
				src={staticFile(layout.subtitleAsset)}
				alt=""
				style={{ position: "absolute", left: layout.sideInsetPx, bottom: `${layout.subtitleBottomPercent}%`, width: `${layout.subtitleWidthPercent}%`, maxHeight: `${layout.subtitleMaxHeightPercent}%`, objectFit: "contain", objectPosition: "left center", translate: `0px ${titleMotion.subtitleOffsetY}px` }}
			/>
			<div
				style={{
					position: "absolute",
					left: layout.sideInsetPx,
					bottom: `${layout.separatorBottomPercent}%`,
					width: `${layout.separatorWidthPercent}%`,
					height: 1,
					background: layout.separatorColor,
				}}
			/>
			<svg aria-hidden="true" viewBox="0 0 1600 800" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.06, mixBlendMode: "soft-light", pointerEvents: "none" }}>
				<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="2" seed="17" /><feColorMatrix values=".35 0 0 0 .2 0 .35 0 0 .2 0 0 .35 0 .2 0 0 0 .18 0" /></filter>
				<rect width="100%" height="100%" filter="url(#grain)" />
			</svg>
		</AbsoluteFill>
	);
};
