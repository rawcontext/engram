"use client";

import { useEffect, useState } from "react";
import type { GraphStatsProps } from "./types";

/**
 * Stats bar overlay for the graph showing node and edge counts.
 * Features animated entrance and monochrome + amber styling.
 */
export function GraphStats({ nodeCount, edgeCount }: GraphStatsProps) {
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	return (
		<div
			style={{
				position: "absolute",
				top: "12px",
				left: "12px",
				zIndex: 10,
				display: "flex",
				alignItems: "stretch",
				borderRadius: "10px",
				overflow: "hidden",
				background:
					"linear-gradient(135deg, rgba(10, 15, 25, 0.95) 0%, rgba(15, 20, 30, 0.9) 100%)",
				border: "1px solid rgba(148, 163, 184, 0.15)",
				boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.03)",
			}}
		>
			{/* Nodes stat - white/silver for clean look */}
			<div
				style={{
					padding: "10px 16px",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: "2px",
					borderRight: "1px solid rgba(148, 163, 184, 0.1)",
					opacity: mounted ? 1 : 0,
					transform: mounted ? "translateY(0)" : "translateY(-5px)",
					transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
				}}
			>
				<span
					style={{
						fontFamily: "Orbitron, sans-serif",
						fontSize: "20px",
						fontWeight: 700,
						color: "rgb(226, 232, 240)",
						textShadow: "0 0 20px rgba(226, 232, 240, 0.3)",
						lineHeight: 1,
					}}
				>
					{nodeCount}
				</span>
				<span
					style={{
						fontFamily: "JetBrains Mono, monospace",
						fontSize: "8px",
						fontWeight: 600,
						letterSpacing: "0.15em",
						color: "rgba(100, 116, 139, 0.7)",
						textTransform: "uppercase",
					}}
				>
					nodes
				</span>
			</div>

			{/* Edges stat - amber accent */}
			<div
				style={{
					padding: "10px 16px",
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					gap: "2px",
					opacity: mounted ? 1 : 0,
					transform: mounted ? "translateY(0)" : "translateY(-5px)",
					transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.1s",
				}}
			>
				<span
					style={{
						fontFamily: "Orbitron, sans-serif",
						fontSize: "20px",
						fontWeight: 700,
						color: "rgb(251, 191, 36)",
						textShadow: "0 0 20px rgba(251, 191, 36, 0.5), 0 0 40px rgba(251, 191, 36, 0.25)",
						lineHeight: 1,
					}}
				>
					{edgeCount}
				</span>
				<span
					style={{
						fontFamily: "JetBrains Mono, monospace",
						fontSize: "8px",
						fontWeight: 600,
						letterSpacing: "0.15em",
						color: "rgba(100, 116, 139, 0.7)",
						textTransform: "uppercase",
					}}
				>
					edges
				</span>
			</div>
		</div>
	);
}
