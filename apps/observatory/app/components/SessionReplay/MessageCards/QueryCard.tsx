"use client";

import { memo } from "react";
import type { QueryCardProps } from "../types";

// Input query card - Monochrome palette
function QueryCardInner({ content }: QueryCardProps) {
	return (
		<div
			style={{
				position: "relative",
				padding: "16px 18px",
				background:
					"linear-gradient(135deg, rgba(148, 163, 184, 0.04) 0%, rgba(100, 116, 139, 0.06) 100%)",
				borderRadius: "10px",
				border: "1px solid rgba(148, 163, 184, 0.15)",
				boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 2px 10px rgba(0,0,0,0.2)",
			}}
		>
			{/* Terminal prompt indicator - amber accent */}
			<div
				style={{
					position: "absolute",
					top: "16px",
					left: "-8px",
					width: "16px",
					height: "16px",
					borderRadius: "4px",
					background: "linear-gradient(135deg, rgb(251, 191, 36), rgb(245, 158, 11))",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					boxShadow: "0 0 12px rgba(251, 191, 36, 0.4)",
				}}
			>
				<span
					style={{
						color: "rgb(15, 20, 30)",
						fontSize: "10px",
						fontWeight: 700,
						fontFamily: "JetBrains Mono, monospace",
					}}
				>
					{">"}
				</span>
			</div>

			<div
				style={{
					fontFamily: "JetBrains Mono, monospace",
					fontSize: "13px",
					lineHeight: "1.7",
					color: "rgba(230, 235, 245, 0.95)",
					paddingLeft: "8px",
					borderLeft: "2px solid rgba(148, 163, 184, 0.25)",
				}}
			>
				{content}
			</div>
		</div>
	);
}

export const QueryCard = memo(QueryCardInner);
