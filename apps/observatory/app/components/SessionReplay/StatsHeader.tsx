"use client";

import { memo, useEffect, useState } from "react";
import { MESSAGE_TYPES, type StatsHeaderProps } from "./types";

// Stats header with animated counters - Full palette including ToolCalls
function StatsHeaderInner({ messages }: StatsHeaderProps) {
	const reasoningCount = messages.filter((m) => m.isThinkingBlock).length;
	const toolCallCount = messages.filter((m) => m.type === MESSAGE_TYPES.TOOLCALL).length;
	const responseCount = messages.filter((m) => m.type === MESSAGE_TYPES.RESPONSE).length;
	const turnCount = messages.filter((m) => m.type === MESSAGE_TYPES.TURN).length;
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const stats = [
		{
			label: "TURNS",
			value: turnCount,
			color: "rgb(251, 191, 36)",
			glowColor: "rgba(251, 191, 36, 0.5)",
		},
		{
			label: "REASONING",
			value: reasoningCount,
			color: "rgb(34, 211, 238)",
			glowColor: "rgba(34, 211, 238, 0.5)",
		},
		{
			label: "TOOLS",
			value: toolCallCount,
			color: "rgb(139, 92, 246)",
			glowColor: "rgba(139, 92, 246, 0.5)",
		},
		{
			label: "OUTPUT",
			value: responseCount,
			color: "rgb(226, 232, 240)",
			glowColor: "rgba(226, 232, 240, 0.3)",
		},
	];

	return (
		<div
			style={{
				display: "flex",
				alignItems: "stretch",
				borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
				background:
					"linear-gradient(180deg, rgba(10, 15, 25, 0.95) 0%, rgba(15, 20, 30, 0.8) 100%)",
			}}
		>
			{stats.map((stat, i) => (
				<div
					key={stat.label}
					style={{
						flex: 1,
						padding: "16px 20px",
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						gap: "6px",
						borderRight: i < stats.length - 1 ? "1px solid rgba(148, 163, 184, 0.06)" : "none",
						opacity: mounted ? 1 : 0,
						transform: mounted ? "translateY(0)" : "translateY(-10px)",
						transition: `all 0.5s cubic-bezier(0.4, 0, 0.2, 1) ${i * 0.12}s`,
						position: "relative",
					}}
				>
					{/* Bottom glow accent - colored underline matching stat color */}
					<div
						style={{
							position: "absolute",
							bottom: 0,
							left: "15%",
							right: "15%",
							height: "2px",
							background: `linear-gradient(90deg, transparent, ${stat.color}, transparent)`,
							opacity: 0.6,
							boxShadow: `0 0 8px ${stat.glowColor}`,
						}}
					/>
					<span
						style={{
							fontFamily: "JetBrains Mono, monospace",
							fontSize: "9px",
							fontWeight: 600,
							letterSpacing: "0.2em",
							color: "rgba(100, 116, 139, 0.6)",
							textTransform: "uppercase",
						}}
					>
						{stat.label}
					</span>
					<span
						style={{
							fontFamily: "Orbitron, sans-serif",
							fontSize: "24px",
							fontWeight: 700,
							color: stat.color,
							textShadow: `0 0 30px ${stat.glowColor}, 0 0 60px ${stat.glowColor}`,
							letterSpacing: "0.05em",
						}}
					>
						{stat.value}
					</span>
				</div>
			))}
		</div>
	);
}

export const StatsHeader = memo(StatsHeaderInner);
