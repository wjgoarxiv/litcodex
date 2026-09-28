import { Composition } from "remotion";
import { ReadmeCover } from "./ReadmeCover";

export type ReadmeCoverProps = {
	theme: "light" | "dark";
	mobile: boolean;
};

export const Root = () => (
	<>
		<Composition<ReadmeCoverProps>
			id="ReadmeCoverWideLight"
			component={ReadmeCover}
			width={1600}
			height={800}
			fps={60}
			durationInFrames={300}
			defaultProps={{ theme: "light", mobile: false }}
		/>
		<Composition<ReadmeCoverProps>
			id="ReadmeCoverWideDark"
			component={ReadmeCover}
			width={1600}
			height={800}
			fps={60}
			durationInFrames={300}
			defaultProps={{ theme: "dark", mobile: false }}
		/>
		<Composition<ReadmeCoverProps>
			id="ReadmeCoverMobileLight"
			component={ReadmeCover}
			width={1080}
			height={1350}
			fps={60}
			durationInFrames={300}
			defaultProps={{ theme: "light", mobile: true }}
		/>
		<Composition<ReadmeCoverProps>
			id="ReadmeCoverMobileDark"
			component={ReadmeCover}
			width={1080}
			height={1350}
			fps={60}
			durationInFrames={300}
			defaultProps={{ theme: "dark", mobile: true }}
		/>
	</>
);
