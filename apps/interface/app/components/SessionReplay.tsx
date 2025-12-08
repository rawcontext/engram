"use client";

import type { ReplayResponse, TimelineEvent } from "@lib/types";
import { useEffect, useMemo, useRef, useState } from "react";

// Message type constants
const MESSAGE_TYPES = {
	THOUGHT: "thought",
	ACTION: "action",
	OBSERVATION: "observation",
	SYSTEM: "system",
	RESPONSE: "response",
	TURN: "turn",
	TOOLCALL: "toolcall",
	FILETOUCH: "filetouch",
} as const;

type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

interface SessionReplayProps {
	data: ReplayResponse | null;
	selectedNodeId?: string | null;
	onEventHover?: (nodeId: string | null) => void;
}

interface ConsolidatedMessage {
	id: string;
	type: MessageType;
	content: string;
	timestamp: string;
	endTimestamp?: string;
	tokenCount: number;
	isThinkingBlock: boolean;
	nodeIds: string[];
	isStreaming?: boolean;
	toolName?: string;
	// ToolCall specific fields
	toolType?: string;
	toolStatus?: string;
	argumentsPreview?: string;
	// File operation fields (now embedded in ToolCall)
	filePath?: string;
	fileAction?: string;
}

// Detect if content is a thinking/reasoning block
function isThinkingContent(content: string): boolean {
	const thinkingPatterns = [
		/^<thought>/i,
		/^<thinking>/i,
		/^<reasoning>/i,
		/analyzing/i,
		/checking/i,
		/scanning/i,
		/querying/i,
		/simulating/i,
		/correlating/i,
		/detecting/i,
		/resolving/i,
		/validating/i,
		/generating/i,
	];
	return thinkingPatterns.some((pattern) => pattern.test(content.trim()));
}

function cleanThinkingMarkers(content: string): string {
	return content
		.replace(/<\/?thought>/gi, "")
		.replace(/<\/?thinking>/gi, "")
		.replace(/<\/?reasoning>/gi, "")
		.trim();
}

function consolidateTimeline(timeline: TimelineEvent[]): ConsolidatedMessage[] {
	if (!timeline || timeline.length === 0) return [];

	// Deduplicate timeline events by ID
	const seen = new Set<string>();
	const deduped = timeline.filter((event) => {
		if (!event) return false;
		const id = event.id as string;
		if (!id || seen.has(id)) return false;
		seen.add(id);
		return true;
	});

	const messages: ConsolidatedMessage[] = [];
	let currentMessage: ConsolidatedMessage | null = null;
	let tokenBuffer: string[] = [];

	const flushBuffer = () => {
		if (currentMessage && tokenBuffer.length > 0) {
			currentMessage.content = tokenBuffer.join("").trim();
			currentMessage.tokenCount = tokenBuffer.length;
			currentMessage.isThinkingBlock = isThinkingContent(currentMessage.content);
			if (currentMessage.content) {
				messages.push(currentMessage);
			}
		}
		tokenBuffer = [];
		currentMessage = null;
	};

	for (const event of deduped) {
		if (!event) continue;

		const content = (event.content || event.message || event.text || event.data || "") as string;
		const type = ((event.type as string) || "").toLowerCase();
		const timestamp = event.timestamp as string;
		const nodeId = event.id as string;

		const isToken =
			typeof content === "string" &&
			content.length < 50 &&
			!content.includes("\n") &&
			type.includes("thought");

		const isNewThinkingBlock =
			typeof content === "string" &&
			(content.startsWith("<thought>") ||
				content.startsWith("<thinking>") ||
				content.includes("..."));

		const isCompleteThought =
			typeof content === "string" &&
			content.length > 50 &&
			(content.endsWith("...") || content.endsWith("</thought>"));

		if (isCompleteThought || isNewThinkingBlock) {
			flushBuffer();
			const graphNodeId = (event as { graphNodeId?: string }).graphNodeId || nodeId;
			messages.push({
				id: nodeId || `msg-${messages.length}`,
				type: type.includes("action")
					? "action"
					: type.includes("observation")
						? "observation"
						: type.includes("system")
							? "system"
							: "thought",
				content: cleanThinkingMarkers(content),
				timestamp,
				tokenCount: 1,
				isThinkingBlock: isThinkingContent(content),
				nodeIds: [graphNodeId],
			});
		} else if (isToken) {
			if (!currentMessage) {
				currentMessage = {
					id: nodeId || `msg-${messages.length}`,
					type: "response",
					content: "",
					timestamp,
					tokenCount: 0,
					isThinkingBlock: false,
					nodeIds: [],
				};
			}
			tokenBuffer.push(content);
			currentMessage.nodeIds.push(nodeId);
			currentMessage.endTimestamp = timestamp;
		} else {
			flushBuffer();
			if (typeof content === "string" && content.trim()) {
				// Determine message type from event type
				let msgType: MessageType = MESSAGE_TYPES.THOUGHT;
				if (type.includes(MESSAGE_TYPES.TURN)) {
					msgType = MESSAGE_TYPES.TURN;
				} else if (type.includes(MESSAGE_TYPES.TOOLCALL)) {
					msgType = MESSAGE_TYPES.TOOLCALL;
				} else if (type.includes(MESSAGE_TYPES.FILETOUCH)) {
					msgType = MESSAGE_TYPES.FILETOUCH;
				} else if (type.includes(MESSAGE_TYPES.RESPONSE)) {
					msgType = MESSAGE_TYPES.RESPONSE;
				} else if (type.includes(MESSAGE_TYPES.ACTION)) {
					msgType = MESSAGE_TYPES.ACTION;
				} else if (type.includes(MESSAGE_TYPES.OBSERVATION)) {
					msgType = MESSAGE_TYPES.OBSERVATION;
				} else if (type.includes(MESSAGE_TYPES.SYSTEM)) {
					msgType = MESSAGE_TYPES.SYSTEM;
				}

				// Use graphNodeId for highlighting if available, fallback to event id
				const graphNodeId = (event as { graphNodeId?: string }).graphNodeId || nodeId;
				const toolCallEvent = event as {
					toolName?: string;
					toolType?: string;
					toolStatus?: string;
					argumentsPreview?: string;
					filePath?: string;
					fileAction?: string;
				};
				messages.push({
					id: nodeId || `msg-${messages.length}`,
					type: msgType,
					content: content.trim(),
					timestamp,
					tokenCount: (event as { tokenCount?: number }).tokenCount || 0,
					isThinkingBlock: false,
					nodeIds: [graphNodeId],
					toolName: toolCallEvent.toolName,
					toolType: toolCallEvent.toolType,
					toolStatus: toolCallEvent.toolStatus,
					argumentsPreview: toolCallEvent.argumentsPreview,
					filePath: toolCallEvent.filePath,
					fileAction: toolCallEvent.fileAction,
				});
			}
		}
	}

	flushBuffer();

	if (messages.length > 0) {
		const lastMsg = messages[messages.length - 1];
		if (lastMsg.type === "response" && !lastMsg.content.endsWith(".")) {
			lastMsg.isStreaming = true;
		}
	}

	return messages;
}

// Animated typing cursor - Amber accent
function TypingCursor() {
	return (
		<span
			style={{
				display: "inline-block",
				width: "2px",
				height: "1em",
				marginLeft: "2px",
				background: "rgb(251, 191, 36)",
				verticalAlign: "text-bottom",
				animation: "cursorBlink 1s step-end infinite",
				boxShadow: "0 0 8px rgba(251, 191, 36, 0.8)",
			}}
		/>
	);
}

// Collapsible reasoning trace block - Cyan palette (matches graph)
function ReasoningTrace({
	content,
	isExpanded,
	onToggle,
	index,
}: {
	content: string;
	isExpanded: boolean;
	onToggle: () => void;
	index: number;
}) {
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
					{isExpanded ? "▼" : "▶"}
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

// Hero response card for the final output - Monochrome + Amber
function ResponseCard({
	content,
	tokenCount,
	isStreaming,
	isHighlighted,
}: {
	content: string;
	tokenCount: number;
	isStreaming?: boolean;
	isHighlighted: boolean;
}) {
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

// Input query card - Monochrome palette
function QueryCard({ content }: { content: string }) {
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

// Turn header - Amber palette (matches Turn nodes in graph)
function TurnHeader({ turnNumber }: { turnNumber: string }) {
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

// FileTouch card - Green palette (matches FileTouch nodes in graph)
function FileTouchCard({
	filePath,
	toolName,
	diffContent,
}: {
	filePath: string;
	toolName?: string;
	diffContent?: string;
}) {
	const [isExpanded, setIsExpanded] = useState(false);

	const getToolIcon = (tool?: string) => {
		switch (tool?.toLowerCase()) {
			case "read":
				return "📖";
			case "edit":
				return "✏️";
			case "write":
				return "📝";
			case "glob":
				return "🔍";
			case "grep":
				return "🔎";
			default:
				return "📄";
		}
	};

	// Generate mock diff preview based on tool type (in real app, this would come from API)
	const getDiffPreview = () => {
		if (diffContent) return diffContent;
		// Simulated preview based on file path
		const fileName = filePath.split("/").pop() || "file";
		if (toolName === "edit" || toolName === "write") {
			return `+ import { ThrottlerGuard } from '@nestjs/throttler';\n  @UseGuards(AuthGuard)\n+ @UseGuards(ThrottlerGuard)`;
		}
		if (toolName === "read") {
			return `  export class ${fileName.replace(/\.\w+$/, "")} {\n    constructor() { ... }\n  }`;
		}
		return `  // ${fileName}\n  ...`;
	};

	const diffPreview = getDiffPreview();
	const previewLines = diffPreview.split("\n").slice(0, 3).join("\n");
	const hasMoreLines = diffPreview.split("\n").length > 3;

	return (
		<div
			style={{
				background:
					"linear-gradient(135deg, rgba(34, 197, 94, 0.04) 0%, rgba(34, 197, 94, 0.08) 100%)",
				borderRadius: "8px",
				border: "1px solid rgba(34, 197, 94, 0.2)",
				borderLeft: "3px solid rgb(34, 197, 94)",
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
				<span style={{ fontSize: "14px" }}>{getToolIcon(toolName)}</span>
				<div style={{ flex: 1, minWidth: 0 }}>
					{toolName && (
						<span
							style={{
								fontFamily: "JetBrains Mono, monospace",
								fontSize: "9px",
								fontWeight: 600,
								color: "rgb(34, 197, 94)",
								letterSpacing: "0.1em",
								textTransform: "uppercase",
								marginRight: "8px",
							}}
						>
							{toolName}
						</span>
					)}
					<span
						style={{
							fontFamily: "JetBrains Mono, monospace",
							fontSize: "11px",
							color: "rgba(200, 220, 200, 0.9)",
							wordBreak: "break-all",
						}}
					>
						{filePath}
					</span>
				</div>
				{/* Expand/collapse button */}
				<button
					type="button"
					onClick={() => setIsExpanded(!isExpanded)}
					style={{
						padding: "4px 8px",
						borderRadius: "4px",
						background: isExpanded ? "rgba(34, 197, 94, 0.2)" : "rgba(34, 197, 94, 0.1)",
						border: "1px solid rgba(34, 197, 94, 0.3)",
						color: "rgb(34, 197, 94)",
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
					{isExpanded ? "HIDE" : "DIFF"}
				</button>
			</div>

			{/* Collapsible code diff area */}
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
						border: "1px solid rgba(34, 197, 94, 0.15)",
						fontFamily: "JetBrains Mono, monospace",
						fontSize: "10px",
						lineHeight: "1.6",
						whiteSpace: "pre",
						overflowX: "auto",
					}}
				>
					{(isExpanded ? diffPreview : previewLines).split("\n").map((line, i) => {
						const isAddition = line.startsWith("+");
						const isDeletion = line.startsWith("-");
						return (
							<div
								key={i}
								style={{
									color: isAddition
										? "rgb(74, 222, 128)"
										: isDeletion
											? "rgb(248, 113, 113)"
											: "rgba(180, 200, 180, 0.8)",
									background: isAddition
										? "rgba(74, 222, 128, 0.1)"
										: isDeletion
											? "rgba(248, 113, 113, 0.1)"
											: "transparent",
									marginLeft: "-12px",
									marginRight: "-12px",
									paddingLeft: "12px",
									paddingRight: "12px",
								}}
							>
								{line}
							</div>
						);
					})}
					{!isExpanded && hasMoreLines && (
						<div style={{ color: "rgba(100, 116, 139, 0.5)", marginTop: "4px" }}>...</div>
					)}
				</div>
			</div>
		</div>
	);
}

// ToolCall card - Violet/Purple palette (matches ToolCall nodes in graph)
// File operations now show file_path directly on the ToolCall
function ToolCallCard({
	toolName,
	toolType,
	status,
	argumentsPreview,
	filePath,
	fileAction,
}: {
	toolName: string;
	toolType?: string;
	status?: string;
	argumentsPreview?: string;
	filePath?: string;
	fileAction?: string;
}) {
	const [isExpanded, setIsExpanded] = useState(false);

	// Get icon based on tool type
	const getToolIcon = () => {
		// If it's a file operation with a file path, show file-specific icons
		if (filePath) {
			switch (fileAction?.toLowerCase()) {
				case "read":
					return "📖";
				case "edit":
					return "✏️";
				case "create":
				case "write":
					return "📝";
				case "search":
					return "🔍";
				default:
					return "📄";
			}
		}
		switch (toolType?.toLowerCase()) {
			case "file_read":
				return "📖";
			case "file_write":
			case "file_edit":
				return "✏️";
			case "file_glob":
			case "file_grep":
				return "🔍";
			case "bash_exec":
				return "⚡";
			case "web_fetch":
			case "web_search":
				return "🌐";
			case "agent_spawn":
				return "🤖";
			case "mcp":
				return "🔌";
			default:
				return "⚙️";
		}
	};

	// Status indicator color
	const getStatusColor = () => {
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
	};

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
				<span style={{ fontSize: "14px" }}>{getToolIcon()}</span>
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
									background: getStatusColor(),
									boxShadow: `0 0 8px ${getStatusColor()}`,
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

// Stats header with animated counters - Full palette including ToolCalls
function StatsHeader({ messages }: { messages: ConsolidatedMessage[] }) {
	const reasoningCount = messages.filter((m) => m.isThinkingBlock).length;
	const toolCallCount = messages.filter((m) => m.type === MESSAGE_TYPES.TOOLCALL).length;
	const responseCount = messages.filter((m) => m.type === MESSAGE_TYPES.RESPONSE).length;
	const fileTouchCount = messages.filter((m) => m.type === MESSAGE_TYPES.FILETOUCH).length;
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
			label: "FILES",
			value: fileTouchCount,
			color: "rgb(34, 197, 94)",
			glowColor: "rgba(34, 197, 94, 0.5)",
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

// Timestamp badge
function TimestampBadge({ timestamp }: { timestamp: string }) {
	const formatTime = (ts: string) => {
		try {
			return new Date(ts).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});
		} catch {
			return "";
		}
	};

	return (
		<span
			style={{
				fontFamily: "JetBrains Mono, monospace",
				fontSize: "9px",
				color: "rgba(100, 116, 139, 0.5)",
				letterSpacing: "0.05em",
			}}
		>
			{formatTime(timestamp)}
		</span>
	);
}

// Loading state - Amber accent
function LoadingState() {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				height: "100%",
				gap: "20px",
				padding: "40px",
			}}
		>
			{/* Animated neural loader */}
			<div style={{ position: "relative", width: "60px", height: "60px" }}>
				{[0, 1, 2].map((i) => (
					<div
						key={i}
						style={{
							position: "absolute",
							inset: `${i * 8}px`,
							border: "2px solid transparent",
							borderTopColor: `rgba(251, 191, 36, ${0.8 - i * 0.25})`,
							borderRadius: "50%",
							animation: `spin ${1.2 + i * 0.3}s linear infinite ${i % 2 === 0 ? "" : "reverse"}`,
						}}
					/>
				))}
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						width: "8px",
						height: "8px",
						borderRadius: "50%",
						background: "rgb(251, 191, 36)",
						boxShadow: "0 0 20px rgba(251, 191, 36, 0.6)",
						animation: "pulse 1.5s ease-in-out infinite",
					}}
				/>
			</div>

			<div style={{ textAlign: "center" }}>
				<p
					style={{
						fontFamily: "Orbitron, sans-serif",
						fontSize: "12px",
						fontWeight: 600,
						letterSpacing: "0.2em",
						color: "rgb(251, 191, 36)",
						marginBottom: "6px",
					}}
				>
					SYNCHRONIZING
				</p>
				<p
					style={{
						fontFamily: "JetBrains Mono, monospace",
						fontSize: "10px",
						color: "rgba(100, 116, 139, 0.6)",
					}}
				>
					Establishing neural link...
				</p>
			</div>

			<style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
                    50% { opacity: 0.5; transform: translate(-50%, -50%) scale(1.3); }
                }
            `}</style>
		</div>
	);
}

// Empty state - Monochrome + Amber aesthetic
function EmptyState() {
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				height: "100%",
				gap: "20px",
				padding: "40px",
				textAlign: "center",
			}}
		>
			{/* Animated stream icon */}
			<div style={{ position: "relative", width: "64px", height: "64px" }}>
				{/* Outer pulsing ring */}
				<div
					style={{
						position: "absolute",
						inset: "-4px",
						borderRadius: "50%",
						border: "1px solid rgba(251, 191, 36, 0.2)",
						animation: "emptyPulseStream 3s ease-in-out infinite",
					}}
				/>
				{/* Main icon container */}
				<div
					style={{
						width: "64px",
						height: "64px",
						borderRadius: "50%",
						background:
							"linear-gradient(135deg, rgba(251, 191, 36, 0.08) 0%, rgba(148, 163, 184, 0.04) 100%)",
						border: "1px solid rgba(148, 163, 184, 0.15)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						boxShadow: "0 4px 24px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255,255,255,0.03)",
					}}
				>
					<svg
						width="28"
						height="28"
						viewBox="0 0 24 24"
						fill="none"
						stroke="rgba(251, 191, 36, 0.5)"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						{/* Thought stream / brain wave icon */}
						<path d="M2 12h4l3-9 4 18 3-9h4" opacity="0.7" />
						<circle cx="12" cy="12" r="2" fill="rgba(251, 191, 36, 0.3)" />
					</svg>
				</div>
				{/* Center glow */}
				<div
					style={{
						position: "absolute",
						top: "50%",
						left: "50%",
						transform: "translate(-50%, -50%)",
						width: "8px",
						height: "8px",
						borderRadius: "50%",
						background: "rgba(251, 191, 36, 0.4)",
						boxShadow: "0 0 20px rgba(251, 191, 36, 0.3)",
						animation: "emptyGlowStream 2s ease-in-out infinite",
					}}
				/>
			</div>

			{/* Text content */}
			<div>
				<p
					style={{
						fontFamily: "Orbitron, sans-serif",
						fontSize: "12px",
						fontWeight: 600,
						letterSpacing: "0.15em",
						color: "rgba(226, 232, 240, 0.7)",
						marginBottom: "8px",
						textTransform: "uppercase",
					}}
				>
					No Cognitive Events
				</p>
				<p
					style={{
						fontFamily: "JetBrains Mono, monospace",
						fontSize: "11px",
						color: "rgba(100, 116, 139, 0.6)",
						letterSpacing: "0.02em",
					}}
				>
					Awaiting thought stream...
				</p>
			</div>

			<style>{`
                @keyframes emptyPulseStream {
                    0%, 100% { transform: scale(1); opacity: 0.4; }
                    50% { transform: scale(1.1); opacity: 0.2; }
                }
                @keyframes emptyGlowStream {
                    0%, 100% { opacity: 0.4; transform: translate(-50%, -50%) scale(1); }
                    50% { opacity: 0.8; transform: translate(-50%, -50%) scale(1.2); }
                }
            `}</style>
		</div>
	);
}

export function SessionReplay({ data, selectedNodeId, onEventHover }: SessionReplayProps) {
	const [hoveredNodeIds, setHoveredNodeIds] = useState<string[] | null>(null);
	const [expandedTraces, setExpandedTraces] = useState<Set<string>>(new Set());
	const scrollRef = useRef<HTMLDivElement>(null);

	const messages = useMemo(() => {
		if (!data?.timeline) return [];
		return consolidateTimeline(data.timeline);
	}, [data?.timeline]);

	const handleHover = (nodeIds: string[] | null) => {
		setHoveredNodeIds(nodeIds);
		if (onEventHover && nodeIds && nodeIds.length > 0) {
			onEventHover(nodeIds[0]);
		} else if (onEventHover) {
			onEventHover(null);
		}
	};

	const toggleTrace = (id: string) => {
		setExpandedTraces((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	if (!data) {
		return <LoadingState />;
	}

	if (!data.timeline || data.timeline.length === 0) {
		return <EmptyState />;
	}

	// Track reasoning index for trace numbering
	let reasoningIndex = 0;

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
			}}
		>
			{/* Stats Header */}
			<StatsHeader messages={messages} />

			{/* Scrollable content */}
			<div
				ref={scrollRef}
				style={{
					flex: 1,
					overflowY: "auto",
					overflowX: "hidden",
					padding: "24px 20px",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "8px",
						maxWidth: "100%",
						position: "relative",
					}}
				>
					{/* Timeline connector line - Monochrome + Amber */}
					<div
						style={{
							position: "absolute",
							left: "11px",
							top: "40px",
							bottom: "40px",
							width: "2px",
							background:
								"linear-gradient(180deg, rgba(148, 163, 184, 0.2) 0%, rgba(251, 191, 36, 0.35) 30%, rgba(251, 191, 36, 0.35) 70%, rgba(226, 232, 240, 0.25) 100%)",
							borderRadius: "1px",
							zIndex: 0,
						}}
					/>

					{/* Render messages in order */}
					{messages.map((msg, i) => {
						const isHighlighted = selectedNodeId
							? msg.nodeIds.includes(selectedNodeId)
							: hoveredNodeIds
								? msg.nodeIds.some((id) => hoveredNodeIds.includes(id))
								: true;

						// Turn header
						if (msg.type === MESSAGE_TYPES.TURN) {
							return (
								<div
									key={`${msg.id}-${i}`}
									style={{
										animation: `fadeInUp 0.3s ease-out ${i * 0.03}s backwards`,
										position: "relative",
										paddingLeft: "32px",
										marginTop: i > 0 ? "16px" : "0",
									}}
									onMouseEnter={() => handleHover(msg.nodeIds)}
									onMouseLeave={() => handleHover(null)}
								>
									{/* Timeline node - amber for turns */}
									<div
										style={{
											position: "absolute",
											left: "2px",
											top: "12px",
											width: "20px",
											height: "20px",
											borderRadius: "50%",
											background: "linear-gradient(135deg, rgb(251, 191, 36), rgb(245, 158, 11))",
											boxShadow: "0 0 12px rgba(251, 191, 36, 0.4)",
											zIndex: 1,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
										}}
									>
										<div
											style={{
												width: "6px",
												height: "6px",
												borderRadius: "50%",
												background: "rgb(15, 20, 30)",
											}}
										/>
									</div>
									<TurnHeader turnNumber={msg.content} />
								</div>
							);
						}

						// ToolCall card
						if (msg.type === MESSAGE_TYPES.TOOLCALL) {
							return (
								<div
									key={`${msg.id}-${i}`}
									style={{
										animation: `fadeInUp 0.3s ease-out ${i * 0.03}s backwards`,
										position: "relative",
										paddingLeft: "32px",
										opacity: isHighlighted ? 1 : 0.4,
										transition: "opacity 0.2s ease",
									}}
									onMouseEnter={() => handleHover(msg.nodeIds)}
									onMouseLeave={() => handleHover(null)}
								>
									{/* Timeline node - purple for tool calls */}
									<div
										style={{
											position: "absolute",
											left: "4px",
											top: "10px",
											width: "16px",
											height: "16px",
											borderRadius: "50%",
											background: "rgb(15, 20, 30)",
											border: "3px solid rgb(139, 92, 246)",
											boxShadow: "0 0 10px rgba(139, 92, 246, 0.4)",
											zIndex: 1,
										}}
									/>
									<ToolCallCard
										toolName={msg.toolName || msg.content}
										toolType={msg.toolType}
										status={msg.toolStatus}
										argumentsPreview={msg.argumentsPreview}
										filePath={msg.filePath}
										fileAction={msg.fileAction}
									/>
								</div>
							);
						}

						// FileTouch card
						if (msg.type === MESSAGE_TYPES.FILETOUCH) {
							return (
								<div
									key={`${msg.id}-${i}`}
									style={{
										animation: `fadeInUp 0.3s ease-out ${i * 0.03}s backwards`,
										position: "relative",
										paddingLeft: "32px",
										opacity: isHighlighted ? 1 : 0.4,
										transition: "opacity 0.2s ease",
									}}
									onMouseEnter={() => handleHover(msg.nodeIds)}
									onMouseLeave={() => handleHover(null)}
								>
									{/* Timeline node - green for files */}
									<div
										style={{
											position: "absolute",
											left: "4px",
											top: "10px",
											width: "16px",
											height: "16px",
											borderRadius: "50%",
											background: "rgb(15, 20, 30)",
											border: "3px solid rgb(34, 197, 94)",
											boxShadow: "0 0 10px rgba(34, 197, 94, 0.4)",
											zIndex: 1,
										}}
									/>
									<FileTouchCard filePath={msg.content} toolName={msg.toolName} />
								</div>
							);
						}

						// Reasoning trace (thinking block)
						if (msg.isThinkingBlock) {
							const currentIndex = reasoningIndex++;
							return (
								<div
									key={`${msg.id}-${i}`}
									style={{
										animation: `fadeInUp 0.3s ease-out ${i * 0.03}s backwards`,
										position: "relative",
										paddingLeft: "32px",
										opacity: isHighlighted ? 1 : 0.4,
										transition: "opacity 0.2s ease",
									}}
									onMouseEnter={() => handleHover(msg.nodeIds)}
									onMouseLeave={() => handleHover(null)}
								>
									{/* Timeline node - cyan for reasoning */}
									<div
										style={{
											position: "absolute",
											left: "4px",
											top: "12px",
											width: "16px",
											height: "16px",
											borderRadius: "50%",
											background: "rgb(15, 20, 30)",
											border: "3px solid rgb(34, 211, 238)",
											boxShadow: "0 0 10px rgba(34, 211, 238, 0.4)",
											zIndex: 1,
										}}
									/>
									<ReasoningTrace
										content={msg.content}
										isExpanded={expandedTraces.has(msg.id)}
										onToggle={() => toggleTrace(msg.id)}
										index={currentIndex}
									/>
								</div>
							);
						}

						// Response card
						if (msg.type === MESSAGE_TYPES.RESPONSE) {
							return (
								<div
									key={`${msg.id}-${i}`}
									style={{
										animation: `fadeInUp 0.3s ease-out ${i * 0.03}s backwards`,
										position: "relative",
										paddingLeft: "32px",
										marginTop: "8px",
										opacity: isHighlighted ? 1 : 0.4,
										transition: "opacity 0.2s ease",
									}}
									onMouseEnter={() => handleHover(msg.nodeIds)}
									onMouseLeave={() => handleHover(null)}
								>
									{/* Timeline node - larger for output */}
									<div
										style={{
											position: "absolute",
											left: "2px",
											top: "4px",
											width: "20px",
											height: "20px",
											borderRadius: "50%",
											background: "linear-gradient(135deg, rgb(226, 232, 240), rgb(148, 163, 184))",
											boxShadow: "0 0 12px rgba(226, 232, 240, 0.3)",
											zIndex: 1,
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
										}}
									>
										<div
											style={{
												width: "6px",
												height: "6px",
												borderRadius: "50%",
												background: "rgb(15, 20, 30)",
											}}
										/>
									</div>
									<ResponseCard
										content={msg.content}
										tokenCount={msg.tokenCount}
										isStreaming={msg.isStreaming}
										isHighlighted={isHighlighted}
									/>
								</div>
							);
						}

						// Query/thought card (user input)
						if (msg.type === MESSAGE_TYPES.THOUGHT && !msg.isThinkingBlock) {
							return (
								<div
									key={`${msg.id}-${i}`}
									style={{
										animation: `fadeInUp 0.3s ease-out ${i * 0.03}s backwards`,
										position: "relative",
										paddingLeft: "32px",
									}}
									onMouseEnter={() => handleHover(msg.nodeIds)}
									onMouseLeave={() => handleHover(null)}
								>
									{/* Timeline node - slate/silver */}
									<div
										style={{
											position: "absolute",
											left: "4px",
											top: "16px",
											width: "16px",
											height: "16px",
											borderRadius: "50%",
											background: "rgb(15, 20, 30)",
											border: "3px solid rgb(148, 163, 184)",
											boxShadow: "0 0 10px rgba(148, 163, 184, 0.3)",
											zIndex: 1,
										}}
									/>
									<QueryCard content={msg.content} />
								</div>
							);
						}

						// Default: skip unknown types
						return null;
					})}
				</div>
			</div>

			{/* Global styles */}
			<style>{`
                @keyframes fadeInUp {
                    from {
                        opacity: 0;
                        transform: translateY(10px);
                    }
                    to {
                        opacity: 1;
                        transform: translateY(0);
                    }
                }
                @keyframes cursorBlink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0; }
                }
            `}</style>
		</div>
	);
}
