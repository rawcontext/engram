"use client";

import { memo } from "react";
import type { ResponseCardProps } from "../types";
import { TypingCursor } from "./TypingCursor";

// Hero response card for the final output - Monochrome + Amber
function ResponseCardInner({ content, tokenCount, isStreaming, isHighlighted }: ResponseCardProps) {
	return (
		<div
			style={{
				position: "relative",
				background:
					"linear-gradient(135deg, rgba(226, 232, 240, 0.02) 0%, rgba(148, 163, 184, 0.04) 50%, rgba(226, 232, 240, 0.02) 100%)",
				border: "1px solid rgba(226, 232, 240, 0.2)",
				borderRadius: "12px",
				padding: "20px",
				transition: "all 0.3s ease",
				boxShadow: isHighlighted
					? "0 0 40px rgba(226, 232, 240, 0.08), 0 8px 32px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)"
					: "0 4px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.03)",
			}}
		>
			{/* Top accent glow line - amber */}
			<div
				style={{
					position: "absolute",
					top: "-1px",
					left: "10%",
					right: "10%",
					height: "2px",
					background: "linear-gradient(90deg, transparent, rgb(251, 191, 36), transparent)",
					borderRadius: "2px",
					boxShadow: "0 0 15px rgba(251, 191, 36, 0.4)",
				}}
			/>

			{/* Header */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "12px",
					marginBottom: "16px",
					paddingBottom: "14px",
					borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
				}}
			>
				{/* Neural output icon */}
				<div
					style={{
						width: "28px",
						height: "28px",
						borderRadius: "6px",
						background:
							"linear-gradient(135deg, rgba(251, 191, 36, 0.15), rgba(245, 158, 11, 0.1))",
						border: "1px solid rgba(251, 191, 36, 0.25)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						boxShadow: "0 0 12px rgba(251, 191, 36, 0.15)",
					}}
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="rgb(251, 191, 36)"
						strokeWidth="2"
					>
						<circle cx="12" cy="12" r="3" />
						<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
					</svg>
				</div>

				<span
					style={{
						fontFamily: "Orbitron, sans-serif",
						fontSize: "12px",
						fontWeight: 600,
						letterSpacing: "0.2em",
						color: "rgb(226, 232, 240)",
						textTransform: "uppercase",
					}}
				>
					Output
				</span>

				<span
					style={{
						marginLeft: "auto",
						fontFamily: "JetBrains Mono, monospace",
						fontSize: "10px",
						fontWeight: 600,
						color: "rgba(148, 163, 184, 0.8)",
						padding: "5px 10px",
						background: "rgba(148, 163, 184, 0.08)",
						borderRadius: "6px",
						border: "1px solid rgba(148, 163, 184, 0.15)",
						letterSpacing: "0.05em",
					}}
				>
					{tokenCount} tokens
				</span>
			</div>

			{/* Content */}
			<div
				style={{
					fontSize: "13px",
					lineHeight: "1.9",
					color: "rgba(245, 250, 255, 0.95)",
					fontFamily: "JetBrains Mono, monospace",
					letterSpacing: "0.015em",
				}}
			>
				{content}
				{isStreaming && <TypingCursor />}
			</div>
		</div>
	);
}

export const ResponseCard = memo(ResponseCardInner);
