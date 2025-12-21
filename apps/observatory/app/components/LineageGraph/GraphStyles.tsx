/**
 * SVG gradient definitions for graph edges.
 * Rendered once in the graph container.
 */
export function GraphSvgDefs() {
	return (
		<svg style={{ position: "absolute", width: 0, height: 0 }}>
			<defs>
				{/* Slate edge gradient with amber warmth at center */}
				<linearGradient id="edge-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor="rgb(148, 163, 184)" stopOpacity="0.5" />
					<stop offset="50%" stopColor="rgb(251, 191, 36)" stopOpacity="0.4" />
					<stop offset="100%" stopColor="rgb(148, 163, 184)" stopOpacity="0.5" />
				</linearGradient>
				<linearGradient id="edge-gradient-highlighted" x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor="rgb(226, 232, 240)" stopOpacity="0.8" />
					<stop offset="100%" stopColor="rgb(251, 191, 36)" stopOpacity="0.8" />
				</linearGradient>
			</defs>
		</svg>
	);
}

/**
 * CSS styles for React Flow customization.
 * Includes edge animations, control styling, and minimap theming.
 */
export function GraphCssStyles() {
	return (
		<style>{`
			/* GPU acceleration for pan/zoom transforms */
			.react-flow__viewport {
				will-change: transform;
			}
			.react-flow__edge-path {
				stroke: url(#edge-gradient) !important;
				stroke-width: 1.5px !important;
			}
			.react-flow__edge.animated .react-flow__edge-path {
				stroke-dasharray: 5 3;
				animation: edgeFlow 1s linear infinite;
			}
			@keyframes edgeFlow {
				from { stroke-dashoffset: 16; }
				to { stroke-dashoffset: 0; }
			}
			.react-flow__controls {
				background: linear-gradient(180deg, rgba(8, 12, 20, 0.98) 0%, rgba(12, 16, 24, 0.95) 100%) !important;
				border: 1px solid rgba(148, 163, 184, 0.12) !important;
				border-radius: 8px !important;
				box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.02) !important;
				overflow: hidden;
			}
			.react-flow__controls-button {
				background: transparent !important;
				border: none !important;
				border-bottom: 1px solid rgba(148, 163, 184, 0.06) !important;
				color: rgba(148, 163, 184, 0.5) !important;
				width: 30px !important;
				height: 30px !important;
				transition: all 0.2s ease !important;
			}
			.react-flow__controls-button:hover {
				background: rgba(251, 191, 36, 0.08) !important;
				color: rgb(251, 191, 36) !important;
			}
			.react-flow__controls-button:last-child {
				border-bottom: none !important;
			}
			.react-flow__controls-button svg {
				fill: currentColor !important;
				max-width: 14px !important;
				max-height: 14px !important;
			}
			.react-flow__minimap {
				background: linear-gradient(180deg, rgba(8, 12, 20, 0.98) 0%, rgba(12, 16, 24, 0.95) 100%) !important;
				border: 1px solid rgba(148, 163, 184, 0.12) !important;
				border-radius: 8px !important;
				box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5) !important;
				overflow: hidden;
			}
			.react-flow__minimap-mask {
				fill: rgba(5, 8, 12, 0.8) !important;
			}
			/* Optimize node rendering */
			.react-flow__node {
				will-change: transform;
			}
		`}</style>
	);
}

/**
 * Overlay effects for visual depth (vignette and scanlines)
 */
export function GraphOverlays() {
	return (
		<>
			{/* Radial vignette overlay for depth */}
			<div
				style={{
					position: "absolute",
					inset: 0,
					pointerEvents: "none",
					zIndex: 5,
					background:
						"radial-gradient(ellipse at center, transparent 0%, transparent 40%, rgba(0, 0, 0, 0.3) 100%)",
				}}
			/>

			{/* Subtle scanline effect */}
			<div
				style={{
					position: "absolute",
					inset: 0,
					pointerEvents: "none",
					zIndex: 6,
					opacity: 0.02,
					background:
						"repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(148, 163, 184, 0.5) 2px, rgba(148, 163, 184, 0.5) 4px)",
				}}
			/>
		</>
	);
}
