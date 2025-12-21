"use client";

import { memo, useCallback, useMemo, useRef, useState } from "react";
import { EmptyState } from "./EmptyState";
import { LoadingState } from "./LoadingState";
import { StatsHeader } from "./StatsHeader";
import { Timeline } from "./Timeline";
import type { SessionReplayProps } from "./types";
import { consolidateTimeline } from "./utils/consolidateTimeline";

function SessionReplayInner({ data, selectedNodeId, onEventHover }: SessionReplayProps) {
	const [hoveredNodeIds, setHoveredNodeIds] = useState<string[] | null>(null);
	const [expandedTraces, setExpandedTraces] = useState<Set<string>>(new Set());
	const scrollRef = useRef<HTMLDivElement>(null);

	const messages = useMemo(() => {
		if (!data?.timeline) return [];
		return consolidateTimeline(data.timeline);
	}, [data?.timeline]);

	const handleHover = useCallback(
		(nodeIds: string[] | null) => {
			setHoveredNodeIds(nodeIds);
			if (onEventHover && nodeIds && nodeIds.length > 0) {
				onEventHover(nodeIds[0]);
			} else if (onEventHover) {
				onEventHover(null);
			}
		},
		[onEventHover],
	);

	const toggleTrace = useCallback((id: string) => {
		setExpandedTraces((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	}, []);

	if (!data) {
		return <LoadingState />;
	}

	if (!data.timeline || data.timeline.length === 0) {
		return <EmptyState />;
	}

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
				<Timeline
					messages={messages}
					selectedNodeId={selectedNodeId}
					hoveredNodeIds={hoveredNodeIds}
					expandedTraces={expandedTraces}
					onHover={handleHover}
					onToggleTrace={toggleTrace}
				/>
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

export const SessionReplay = memo(SessionReplayInner);

// Re-export types for consumers
export type { SessionReplayProps } from "./types";
