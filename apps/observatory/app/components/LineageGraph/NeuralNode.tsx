"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import React, { useContext, useMemo, useState } from "react";
import { getNodeConfig } from "./config/nodeTypeConfig";
import { HighlightContext } from "./HighlightContext";
import { LAYOUT_CONSTANTS } from "./types";

const { nodeWidth } = LAYOUT_CONSTANTS;

/**
 * Custom neural-styled node component for the lineage graph.
 * Renders with type-specific colors, icons, and hover/highlight effects.
 */
export const NeuralNode = React.memo(function NeuralNode({ data, selected, id }: NodeProps) {
	const nodeType = (data.type as string)?.toLowerCase() || "default";
	const isSession = nodeType === "session";
	const config = getNodeConfig(nodeType);
	const highlightedNodeIds = useContext(HighlightContext);
	const isHighlighted = highlightedNodeIds.has(id);
	const [isHovered, setIsHovered] = useState(false);

	// Truncate label for display
	const displayLabel = useMemo(() => {
		const label = data.label as string;
		if (!label) return "Node";
		// For UUIDs, show first 8 chars
		if (label.match(/^[a-f0-9-]{36}$/i)) {
			return `${label.slice(0, 8)}...`;
		}
		return label.length > 16 ? `${label.slice(0, 16)}...` : label;
	}, [data.label]);

	const isActive = selected || isHighlighted || isHovered;

	return (
		<div
			style={{
				width: isSession ? nodeWidth + 40 : nodeWidth,
				transform: isActive ? "scale(1.08)" : "scale(1)",
				transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
				position: "relative",
			}}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			{/* Outer glow effect - always visible for session, on hover for others */}
			<div
				style={{
					position: "absolute",
					inset: "-8px",
					borderRadius: isSession ? "20px" : "14px",
					background: `radial-gradient(ellipse at center, ${config.glow}, transparent 70%)`,
					filter: "blur(16px)",
					opacity: isSession ? 0.6 : isActive ? 0.7 : 0,
					transition: "opacity 0.3s ease",
					pointerEvents: "none",
				}}
			/>

			{/* Animated effects for session node */}
			{isSession && <SessionAnimations border={config.border} />}

			{/* Main node container */}
			<div
				style={{
					position: "relative",
					borderRadius: isSession ? "14px" : "10px",
					background: isSession
						? `linear-gradient(135deg, rgba(226, 232, 240, 0.12) 0%, rgba(12, 15, 22, 0.98) 50%, rgba(226, 232, 240, 0.06) 100%)`
						: `linear-gradient(135deg, ${config.bg}, rgba(12, 15, 22, 0.95))`,
					border: `${isSession ? "2px" : "1px"} solid ${isActive ? config.border : config.border.replace(/[\d.]+\)$/, "0.4)")}`,
					boxShadow: isActive
						? `0 0 30px ${config.glow}, 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.1)`
						: `0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255,255,255,0.05)`,
					padding: isSession ? "14px 18px" : "10px 14px",
					display: "flex",
					alignItems: "center",
					gap: isSession ? "12px" : "10px",
					transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
				}}
			>
				{/* Icon with background */}
				{config.icon && (
					<div
						style={{
							width: isSession ? "32px" : "26px",
							height: isSession ? "32px" : "26px",
							borderRadius: isSession ? "8px" : "6px",
							background: `linear-gradient(135deg, ${config.bg.replace(/[\d.]+\)$/, "0.3)")}, ${config.bg})`,
							border: `1px solid ${config.border.replace(/[\d.]+\)$/, "0.3)")}`,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: config.text,
							flexShrink: 0,
							boxShadow: isActive ? `0 0 12px ${config.glow}` : "none",
							transition: "box-shadow 0.2s ease",
						}}
					>
						{config.icon}
					</div>
				)}

				{/* Content */}
				<div style={{ flex: 1, minWidth: 0 }}>
					{/* Type label for session */}
					{isSession && (
						<div
							style={{
								fontFamily: "Orbitron, sans-serif",
								fontSize: "9px",
								fontWeight: 700,
								letterSpacing: "0.2em",
								textTransform: "uppercase",
								color: config.text,
								marginBottom: "4px",
								textShadow: `0 0 10px ${config.glow}`,
							}}
						>
							SESSION
						</div>
					)}
					{/* Type badge for non-session */}
					{!isSession && (
						<div
							style={{
								fontFamily: "JetBrains Mono, monospace",
								fontSize: "8px",
								fontWeight: 600,
								letterSpacing: "0.1em",
								textTransform: "capitalize",
								color: config.text,
								opacity: 0.8,
								marginBottom: "2px",
							}}
						>
							{nodeType}
						</div>
					)}
					{/* Node label */}
					<div
						style={{
							fontSize: isSession ? "12px" : "10px",
							fontWeight: 500,
							fontFamily: "JetBrains Mono, monospace",
							color: isSession ? "rgba(240, 245, 255, 0.95)" : "rgba(180, 190, 210, 0.9)",
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
						title={data.label as string}
					>
						{displayLabel}
					</div>
				</div>
			</div>

			{/* Connection handles - styled */}
			<Handle
				type="target"
				position={Position.Top}
				style={{
					width: "8px",
					height: "8px",
					border: "none",
					background: `linear-gradient(135deg, ${config.text}, ${config.border})`,
					boxShadow: `0 0 8px ${config.glow}`,
					opacity: isActive ? 1 : 0.5,
					transition: "opacity 0.2s ease",
				}}
			/>
			<Handle
				type="source"
				position={Position.Bottom}
				style={{
					width: "8px",
					height: "8px",
					border: "none",
					background: `linear-gradient(135deg, ${config.text}, ${config.border})`,
					boxShadow: `0 0 8px ${config.glow}`,
					opacity: isActive ? 1 : 0.5,
					transition: "opacity 0.2s ease",
				}}
			/>
		</div>
	);
});

/**
 * Animated rings for session nodes
 */
function SessionAnimations({ border }: { border: string }) {
	return (
		<>
			{/* Pulsing glow ring */}
			<div
				style={{
					position: "absolute",
					inset: "-6px",
					borderRadius: "18px",
					border: `2px solid ${border}`,
					animation: "session-pulse 2.5s ease-in-out infinite",
					opacity: 0.6,
				}}
			/>
			{/* Expanding ring */}
			<div
				style={{
					position: "absolute",
					inset: "-8px",
					borderRadius: "22px",
					border: `1px solid ${border}`,
					animation: "session-expand 3s ease-out infinite",
				}}
			/>
			<style>{`
				@keyframes session-pulse {
					0%, 100% { opacity: 0.6; transform: scale(1); }
					50% { opacity: 0.3; transform: scale(1.02); }
				}
				@keyframes session-expand {
					0% { transform: scale(1); opacity: 0.4; }
					100% { transform: scale(1.15); opacity: 0; }
				}
			`}</style>
		</>
	);
}
