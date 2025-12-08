"use client";

import type { ReplayResponse, TimelineEvent } from "@lib/types";
import React, { useEffect, useMemo, useRef, useState } from "react";

interface SessionReplayProps {
	data: ReplayResponse | null;
	selectedNodeId?: string | null;
	onEventHover?: (nodeId: string | null) => void;
}

interface ConsolidatedMessage {
	id: string;
	type: "thought" | "action" | "observation" | "system" | "response";
	content: string;
	timestamp: string;
	endTimestamp?: string;
	tokenCount: number;
	isThinkingBlock: boolean;
	nodeIds: string[];
	isStreaming?: boolean;
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
				nodeIds: [nodeId],
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
				messages.push({
					id: nodeId || `msg-${messages.length}`,
					type: type.includes("action")
						? "action"
						: type.includes("observation")
							? "observation"
							: type.includes("system")
								? "system"
								: "thought",
					content: content.trim(),
					timestamp,
					tokenCount: 1,
					isThinkingBlock: false,
					nodeIds: [nodeId],
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

// Collapsible reasoning trace block - Amber thermal palette
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
					? "linear-gradient(135deg, rgba(251, 191, 36, 0.06) 0%, rgba(251, 191, 36, 0.12) 100%)"
					: isHovered
						? "linear-gradient(135deg, rgba(251, 191, 36, 0.04) 0%, rgba(251, 191, 36, 0.08) 100%)"
						: "linear-gradient(135deg, rgba(251, 191, 36, 0.02) 0%, rgba(251, 191, 36, 0.05) 100%)",
				borderLeft: isExpanded
					? "3px solid rgb(251, 191, 36)"
					: "2px solid rgba(251, 191, 36, 0.3)",
				borderRadius: "0 8px 8px 0",
				overflow: "hidden",
				transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
				boxShadow: isExpanded
					? "0 4px 20px rgba(251, 191, 36, 0.12), inset 0 1px 0 rgba(255,255,255,0.03)"
					: "inset 0 1px 0 rgba(255,255,255,0.02)",
			}}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			<button
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
						background: isExpanded ? "rgba(251, 191, 36, 0.2)" : "rgba(251, 191, 36, 0.1)",
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
							stroke={isExpanded ? "rgb(251, 191, 36)" : "rgba(251, 191, 36, 0.7)"}
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
						color: isExpanded ? "rgb(251, 191, 36)" : "rgba(251, 191, 36, 0.7)",
						padding: "4px 8px",
						background: isExpanded ? "rgba(251, 191, 36, 0.2)" : "rgba(251, 191, 36, 0.1)",
						borderRadius: "4px",
						letterSpacing: "0.08em",
						border: `1px solid ${isExpanded ? "rgba(251, 191, 36, 0.3)" : "rgba(251, 191, 36, 0.15)"}`,
						transition: "all 0.2s ease",
						textShadow: isExpanded ? "0 0 10px rgba(251, 191, 36, 0.5)" : "none",
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
						color: isExpanded ? "rgb(251, 191, 36)" : "rgba(100, 116, 139, 0.6)",
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
						borderTop: "1px solid rgba(251, 191, 36, 0.1)",
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

// Stats header with animated counters - Monochrome + Amber
function StatsHeader({ messages }: { messages: ConsolidatedMessage[] }) {
	const reasoningCount = messages.filter((m) => m.isThinkingBlock).length;
	const responseCount = messages.filter((m) => m.type === "response").length;
	const totalTokens = messages.reduce((sum, m) => sum + m.tokenCount, 0);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const stats = [
		{
			label: "REASONING",
			value: reasoningCount,
			color: "rgb(251, 191, 36)",
			glowColor: "rgba(251, 191, 36, 0.5)",
		},
		{
			label: "OUTPUT",
			value: responseCount,
			color: "rgb(226, 232, 240)",
			glowColor: "rgba(226, 232, 240, 0.3)",
		},
		{
			label: "TOKENS",
			value: totalTokens,
			color: "rgba(148, 163, 184, 0.9)",
			glowColor: "rgba(148, 163, 184, 0.3)",
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
					{/* Top glow accent */}
					{i === 0 && (
						<div
							style={{
								position: "absolute",
								top: 0,
								left: "20%",
								right: "20%",
								height: "2px",
								background: `linear-gradient(90deg, transparent, ${stat.color}, transparent)`,
								opacity: 0.5,
							}}
						/>
					)}
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

	// Group messages: first non-thinking = query, thinking blocks = reasoning, response = output
	const query = messages.find((m) => !m.isThinkingBlock && m.type !== "response");
	const reasoning = messages.filter((m) => m.isThinkingBlock);
	const response = messages.find((m) => m.type === "response");

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

					{/* Query Section */}
					{query && (
						<div
							style={{
								animation: "fadeInUp 0.4s ease-out",
								position: "relative",
								paddingLeft: "32px",
							}}
							onMouseEnter={() => handleHover(query.nodeIds)}
							onMouseLeave={() => handleHover(null)}
						>
							{/* Timeline node - slate/silver */}
							<div
								style={{
									position: "absolute",
									left: "4px",
									top: "28px",
									width: "16px",
									height: "16px",
									borderRadius: "50%",
									background: "rgb(15, 20, 30)",
									border: "3px solid rgb(148, 163, 184)",
									boxShadow: "0 0 10px rgba(148, 163, 184, 0.3)",
									zIndex: 1,
								}}
							/>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "10px",
									marginBottom: "10px",
								}}
							>
								<span
									style={{
										fontFamily: "Orbitron, sans-serif",
										fontSize: "11px",
										fontWeight: 600,
										letterSpacing: "0.2em",
										color: "rgb(148, 163, 184)",
										textTransform: "uppercase",
									}}
								>
									Query
								</span>
								<TimestampBadge timestamp={query.timestamp} />
							</div>
							<QueryCard content={query.content} />
						</div>
					)}

					{/* Reasoning Section - Amber thermal palette */}
					{reasoning.length > 0 && (
						<div
							style={{
								animation: "fadeInUp 0.4s ease-out 0.1s backwards",
								position: "relative",
								paddingLeft: "32px",
								marginTop: "12px",
							}}
						>
							{/* Timeline node */}
							<div
								style={{
									position: "absolute",
									left: "4px",
									top: "4px",
									width: "16px",
									height: "16px",
									borderRadius: "50%",
									background: "rgb(15, 20, 30)",
									border: "3px solid rgb(251, 191, 36)",
									boxShadow: "0 0 12px rgba(251, 191, 36, 0.5)",
									zIndex: 1,
								}}
							/>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "10px",
									marginBottom: "12px",
								}}
							>
								<span
									style={{
										fontFamily: "Orbitron, sans-serif",
										fontSize: "11px",
										fontWeight: 600,
										letterSpacing: "0.2em",
										color: "rgb(251, 191, 36)",
										textTransform: "uppercase",
										textShadow: "0 0 15px rgba(251, 191, 36, 0.4)",
									}}
								>
									Reasoning Trace
								</span>
								<span
									style={{
										fontFamily: "JetBrains Mono, monospace",
										fontSize: "9px",
										fontWeight: 600,
										color: "rgba(251, 191, 36, 0.8)",
										padding: "3px 8px",
										background: "rgba(251, 191, 36, 0.15)",
										borderRadius: "4px",
										border: "1px solid rgba(251, 191, 36, 0.2)",
									}}
								>
									{reasoning.length} steps
								</span>
							</div>

							<div
								style={{
									display: "flex",
									flexDirection: "column",
									gap: "8px",
								}}
							>
								{reasoning.map((msg, i) => {
									const isHighlighted = selectedNodeId
										? msg.nodeIds.includes(selectedNodeId)
										: hoveredNodeIds
											? msg.nodeIds.some((id) => hoveredNodeIds.includes(id))
											: true;

									return (
										<div
											key={`${msg.id}-${i}`}
											style={{
												opacity: isHighlighted ? 1 : 0.4,
												transition: "opacity 0.2s ease",
												animation: `fadeInUp 0.3s ease-out ${0.15 + i * 0.04}s backwards`,
											}}
											onMouseEnter={() => handleHover(msg.nodeIds)}
											onMouseLeave={() => handleHover(null)}
										>
											<ReasoningTrace
												content={msg.content}
												isExpanded={expandedTraces.has(msg.id)}
												onToggle={() => toggleTrace(msg.id)}
												index={i}
											/>
										</div>
									);
								})}
							</div>
						</div>
					)}

					{/* Response Section */}
					{response && (
						<div
							style={{
								animation: "fadeInUp 0.5s ease-out 0.3s backwards",
								position: "relative",
								paddingLeft: "32px",
								marginTop: "12px",
							}}
							onMouseEnter={() => handleHover(response.nodeIds)}
							onMouseLeave={() => handleHover(null)}
						>
							{/* Timeline node - larger for output, amber accent */}
							<div
								style={{
									position: "absolute",
									left: "2px",
									top: "4px",
									width: "20px",
									height: "20px",
									borderRadius: "50%",
									background: "linear-gradient(135deg, rgb(251, 191, 36), rgb(245, 158, 11))",
									boxShadow: "0 0 15px rgba(251, 191, 36, 0.5)",
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
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "10px",
									marginBottom: "12px",
								}}
							>
								<TimestampBadge timestamp={response.timestamp} />
							</div>
							<ResponseCard
								content={response.content}
								tokenCount={response.tokenCount}
								isStreaming={response.isStreaming}
								isHighlighted={
									selectedNodeId
										? response.nodeIds.includes(selectedNodeId)
										: hoveredNodeIds
											? response.nodeIds.some((id) => hoveredNodeIds.includes(id))
											: true
								}
							/>
						</div>
					)}
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
