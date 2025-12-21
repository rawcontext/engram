"use client";

import { memo, useState } from "react";
import type { ReasoningTraceProps } from "../types";

// Collapsible reasoning trace block - Cyan palette (matches graph)
function ReasoningTraceInner({ content, isExpanded, onToggle, index }: ReasoningTraceProps) {
	const [isHovered, setIsHovered] = useState(false);

	return (
		<div
			style={{
				position: "relative",
				background: isExpanded
					? "linear-gradient(135deg, rgba(34, 211, 238, 0.06) 0%, rgba(34, 211, 238, 0.12) 100%)"
					: isHovered
						? "linear-gradient(135deg, rgba(34, 211, 238, 0.04) 0%, rgba(34, 211, 238, 0.08) 100%)"
						: "linear-gradient(135deg, rgba(34, 211, 238, 0.02) 0%, rgba(34, 211, 238, 0.05) 100%)",
				borderLeft: isExpanded
					? "3px solid rgb(34, 211, 238)"
					: "2px solid rgba(34, 211, 238, 0.3)",
				borderRadius: "0 8px 8px 0",
				overflow: "hidden",
				transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
				boxShadow: isExpanded
					? "0 4px 20px rgba(34, 211, 238, 0.12), inset 0 1px 0 rgba(255,255,255,0.03)"
					: "inset 0 1px 0 rgba(255,255,255,0.02)",
			}}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			<button
				type="button"
				onClick={onToggle}
				style={{
					width: "100%",
					padding: "12px 16px",
					display: "flex",
					alignItems: "center",
					gap: "12px",
					background: "transparent",
					border: "none",
					cursor: "pointer",
					transition: "all 0.2s ease",
				}}
			>
				{/* Animated chevron with glow */}
				<div
					style={{
						width: "20px",
						height: "20px",
						borderRadius: "4px",
						background: isExpanded ? "rgba(34, 211, 238, 0.2)" : "rgba(34, 211, 238, 0.1)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						transition: "all 0.2s ease",
						flexShrink: 0,
					}}
				>
					<svg
						width="10"
						height="10"
						viewBox="0 0 10 10"
						fill="none"
						style={{
							transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
							transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
						}}
					>
						<path
							d="M3 1L7 5L3 9"
							stroke={isExpanded ? "rgb(34, 211, 238)" : "rgba(34, 211, 238, 0.7)"}
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</div>

				{/* Step indicator badge */}
				<span
					style={{
						fontFamily: "JetBrains Mono, monospace",
						fontSize: "9px",
						fontWeight: 700,
						color: isExpanded ? "rgb(34, 211, 238)" : "rgba(34, 211, 238, 0.7)",
						padding: "4px 8px",
						background: isExpanded ? "rgba(34, 211, 238, 0.2)" : "rgba(34, 211, 238, 0.1)",
						borderRadius: "4px",
						letterSpacing: "0.08em",
						border: `1px solid ${isExpanded ? "rgba(34, 211, 238, 0.3)" : "rgba(34, 211, 238, 0.15)"}`,
						transition: "all 0.2s ease",
						textShadow: isExpanded ? "0 0 10px rgba(34, 211, 238, 0.5)" : "none",
					}}
				>
					TRACE_{String(index + 1).padStart(2, "0")}
				</span>

				{/* Preview text */}
				<span
					style={{
						flex: 1,
						fontSize: "11px",
						color: isExpanded ? "rgba(200, 210, 230, 0.95)" : "rgba(148, 163, 184, 0.75)",
						fontFamily: "JetBrains Mono, monospace",
						textAlign: "left",
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						transition: "color 0.2s ease",
					}}
				>
					{content.slice(0, 45)}
					{content.length > 45 ? "..." : ""}
				</span>

				{/* Expand indicator */}
				<span
					style={{
						fontSize: "10px",
						color: isExpanded ? "rgb(34, 211, 238)" : "rgba(100, 116, 139, 0.6)",
						fontFamily: "JetBrains Mono, monospace",
						fontWeight: 600,
						transition: "color 0.2s ease",
						opacity: isHovered || isExpanded ? 1 : 0.7,
					}}
				>
					{isExpanded ? "\u25BC" : "\u25B6"}
				</span>
			</button>

			{/* Expanded content with smooth reveal */}
			<div
				style={{
					maxHeight: isExpanded ? "300px" : "0",
					opacity: isExpanded ? 1 : 0,
					overflow: "hidden",
					transition: "all 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
				}}
			>
				<div
					style={{
						padding: "0 16px 16px 48px",
						fontSize: "12px",
						lineHeight: "1.8",
						color: "rgba(180, 190, 210, 0.95)",
						fontFamily: "JetBrains Mono, monospace",
						borderTop: "1px solid rgba(34, 211, 238, 0.1)",
						marginTop: "4px",
						paddingTop: "12px",
					}}
				>
					{content}
				</div>
			</div>
		</div>
	);
}

export const ReasoningTrace = memo(ReasoningTraceInner);
