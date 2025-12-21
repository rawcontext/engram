"use client";

import { memo, useState } from "react";
import type { ToolCallCardProps } from "../types";

// Get icon based on tool type
function getToolIcon(toolType?: string, filePath?: string, fileAction?: string): string {
	// If it's a file operation with a file path, show file-specific icons
	if (filePath) {
		switch (fileAction?.toLowerCase()) {
			case "read":
				return "\uD83D\uDCD6";
			case "edit":
				return "\u270F\uFE0F";
			case "create":
			case "write":
				return "\uD83D\uDCDD";
			case "search":
				return "\uD83D\uDD0D";
			default:
				return "\uD83D\uDCC4";
		}
	}
	switch (toolType?.toLowerCase()) {
		case "file_read":
			return "\uD83D\uDCD6";
		case "file_write":
		case "file_edit":
			return "\u270F\uFE0F";
		case "file_glob":
		case "file_grep":
			return "\uD83D\uDD0D";
		case "bash_exec":
			return "\u26A1";
		case "web_fetch":
		case "web_search":
			return "\uD83C\uDF10";
		case "agent_spawn":
			return "\uD83E\uDD16";
		case "mcp":
			return "\uD83D\uDD0C";
		default:
			return "\u2699\uFE0F";
	}
}

// Status indicator color
function getStatusColor(status?: string): string {
	switch (status?.toLowerCase()) {
		case "success":
			return "rgb(34, 197, 94)"; // Green
		case "error":
			return "rgb(248, 113, 113)"; // Red
		case "pending":
			return "rgb(251, 191, 36)"; // Amber
		default:
			return "rgb(139, 92, 246)"; // Purple
	}
}

// ToolCall card - Violet/Purple palette (matches ToolCall nodes in graph)
// File operations now show file_path directly on the ToolCall
function ToolCallCardInner({
	toolName,
	toolType,
	status,
	argumentsPreview,
	filePath,
	fileAction,
}: ToolCallCardProps) {
	const [isExpanded, setIsExpanded] = useState(false);
	const toolIcon = getToolIcon(toolType, filePath, fileAction);
	const statusColor = getStatusColor(status);

	return (
		<div
			style={{
				background:
					"linear-gradient(135deg, rgba(139, 92, 246, 0.04) 0%, rgba(139, 92, 246, 0.08) 100%)",
				borderRadius: "8px",
				border: "1px solid rgba(139, 92, 246, 0.2)",
				borderLeft: "3px solid rgb(139, 92, 246)",
				overflow: "hidden",
			}}
		>
			{/* Header row */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: "10px",
					padding: "10px 14px",
				}}
			>
				<span style={{ fontSize: "14px" }}>{toolIcon}</span>
				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<span
							style={{
								fontFamily: "JetBrains Mono, monospace",
								fontSize: "10px",
								fontWeight: 600,
								color: "rgb(139, 92, 246)",
								letterSpacing: "0.08em",
								textTransform: "uppercase",
							}}
						>
							TOOL
						</span>
						{toolType && (
							<span
								style={{
									fontFamily: "JetBrains Mono, monospace",
									fontSize: "8px",
									fontWeight: 500,
									color: "rgba(139, 92, 246, 0.7)",
									padding: "2px 6px",
									background: "rgba(139, 92, 246, 0.1)",
									borderRadius: "4px",
									letterSpacing: "0.05em",
								}}
							>
								{toolType}
							</span>
						)}
						{status && (
							<span
								style={{
									width: "6px",
									height: "6px",
									borderRadius: "50%",
									background: statusColor,
									boxShadow: `0 0 8px ${statusColor}`,
								}}
							/>
						)}
					</div>
					<span
						style={{
							fontFamily: "JetBrains Mono, monospace",
							fontSize: "11px",
							color: "rgba(200, 190, 230, 0.9)",
							wordBreak: "break-all",
						}}
					>
						{toolName}
					</span>
					{/* File path display - shown when tool operates on a file */}
					{filePath && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "6px",
								marginTop: "4px",
								padding: "4px 8px",
								background: "rgba(34, 197, 94, 0.08)",
								borderRadius: "4px",
								border: "1px solid rgba(34, 197, 94, 0.15)",
							}}
						>
							{fileAction && (
								<span
									style={{
										fontFamily: "JetBrains Mono, monospace",
										fontSize: "8px",
										fontWeight: 600,
										color: "rgb(34, 197, 94)",
										letterSpacing: "0.1em",
										textTransform: "uppercase",
									}}
								>
									{fileAction}
								</span>
							)}
							<span
								style={{
									fontFamily: "JetBrains Mono, monospace",
									fontSize: "10px",
									color: "rgba(200, 220, 200, 0.9)",
									wordBreak: "break-all",
								}}
							>
								{filePath}
							</span>
						</div>
					)}
				</div>
				{/* Expand/collapse button */}
				{argumentsPreview && (
					<button
						type="button"
						onClick={() => setIsExpanded(!isExpanded)}
						style={{
							padding: "4px 8px",
							borderRadius: "4px",
							background: isExpanded ? "rgba(139, 92, 246, 0.2)" : "rgba(139, 92, 246, 0.1)",
							border: "1px solid rgba(139, 92, 246, 0.3)",
							color: "rgb(139, 92, 246)",
							fontSize: "9px",
							fontFamily: "JetBrains Mono, monospace",
							fontWeight: 600,
							cursor: "pointer",
							display: "flex",
							alignItems: "center",
							gap: "4px",
							transition: "all 0.2s ease",
						}}
					>
						<svg
							width="10"
							height="10"
							viewBox="0 0 10 10"
							fill="none"
							style={{
								transition: "transform 0.2s ease",
								transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
							}}
						>
							<path
								d="M3 1L7 5L3 9"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
						{isExpanded ? "HIDE" : "ARGS"}
					</button>
				)}
			</div>

			{/* Collapsible arguments preview area */}
			{argumentsPreview && (
				<div
					style={{
						maxHeight: isExpanded ? "200px" : "0",
						opacity: isExpanded ? 1 : 0,
						overflow: "hidden",
						transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
					}}
				>
					<div
						style={{
							margin: "0 10px 10px 10px",
							padding: "10px 12px",
							background: "rgba(0, 0, 0, 0.3)",
							borderRadius: "6px",
							border: "1px solid rgba(139, 92, 246, 0.15)",
							fontFamily: "JetBrains Mono, monospace",
							fontSize: "10px",
							lineHeight: "1.6",
							color: "rgba(180, 170, 210, 0.9)",
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
						}}
					>
						{argumentsPreview}
					</div>
				</div>
			)}
		</div>
	);
}

export const ToolCallCard = memo(ToolCallCardInner);
