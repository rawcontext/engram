"use client";

import { memo } from "react";
import type { TurnHeaderProps } from "../types";

// Turn header - Amber palette (matches Turn nodes in graph)
function TurnHeaderInner({ turnNumber }: TurnHeaderProps) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: "12px",
				padding: "12px 0",
				borderBottom: "1px solid rgba(251, 191, 36, 0.15)",
				marginBottom: "8px",
			}}
		>
			<div
				style={{
					width: "24px",
					height: "24px",
					borderRadius: "6px",
					background: "linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.15))",
					border: "1px solid rgba(251, 191, 36, 0.3)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					boxShadow: "0 0 10px rgba(251, 191, 36, 0.2)",
				}}
			>
				<svg
					width="12"
					height="12"
					viewBox="0 0 24 24"
					fill="none"
					stroke="rgb(251, 191, 36)"
					strokeWidth="2"
				>
					<circle cx="12" cy="12" r="3" />
					<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83" />
				</svg>
			</div>
			<span
				style={{
					fontFamily: "Orbitron, sans-serif",
					fontSize: "12px",
					fontWeight: 600,
					letterSpacing: "0.15em",
					color: "rgb(251, 191, 36)",
					textTransform: "uppercase",
					textShadow: "0 0 12px rgba(251, 191, 36, 0.3)",
				}}
			>
				{turnNumber}
			</span>
		</div>
	);
}

export const TurnHeader = memo(TurnHeaderInner);
