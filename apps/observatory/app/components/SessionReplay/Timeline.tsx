"use client";

import { memo } from "react";
import { QueryCard, ReasoningTrace, ResponseCard, ToolCallCard, TurnHeader } from "./MessageCards";
import { type ConsolidatedMessage, MESSAGE_TYPES } from "./types";

interface TimelineProps {
	messages: ConsolidatedMessage[];
	selectedNodeId?: string | null;
	hoveredNodeIds: string[] | null;
	expandedTraces: Set<string>;
	onHover: (nodeIds: string[] | null) => void;
	onToggleTrace: (id: string) => void;
}

function TimelineInner({
	messages,
	selectedNodeId,
	hoveredNodeIds,
	expandedTraces,
	onHover,
	onToggleTrace,
}: TimelineProps) {
	// Track reasoning index for trace numbering
	let reasoningIndex = 0;

	return (
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
							onMouseEnter={() => onHover(msg.nodeIds)}
							onMouseLeave={() => onHover(null)}
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
							onMouseEnter={() => onHover(msg.nodeIds)}
							onMouseLeave={() => onHover(null)}
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
							onMouseEnter={() => onHover(msg.nodeIds)}
							onMouseLeave={() => onHover(null)}
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
								onToggle={() => onToggleTrace(msg.id)}
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
							onMouseEnter={() => onHover(msg.nodeIds)}
							onMouseLeave={() => onHover(null)}
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
							onMouseEnter={() => onHover(msg.nodeIds)}
							onMouseLeave={() => onHover(null)}
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
	);
}

export const Timeline = memo(TimelineInner);
