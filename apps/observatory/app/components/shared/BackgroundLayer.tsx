"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { Particles } from "./Particles";

const NeuralBackground = dynamic(
	() => import("../NeuralBackground").then((mod) => mod.NeuralBackground),
	{ ssr: false },
);

export function BackgroundLayer() {
	return (
		<div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 1 }}>
			<Suspense fallback={null}>
				<NeuralBackground />
			</Suspense>
			<Particles count={30} />
		</div>
	);
}
