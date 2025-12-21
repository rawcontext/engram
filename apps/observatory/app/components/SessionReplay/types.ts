import type { ReplayResponse, TimelineEvent } from "@lib/types";

// Message type constants
export const MESSAGE_TYPES = {
	THOUGHT: "thought",
	ACTION: "action",
	OBSERVATION: "observation",
	SYSTEM: "system",
	RESPONSE: "response",
	TURN: "turn",
	TOOLCALL: "toolcall",
} as const;

export type MessageType = (typeof MESSAGE_TYPES)[keyof typeof MESSAGE_TYPES];

export interface SessionReplayProps {
	data: ReplayResponse | null;
	selectedNodeId?: string | null;
	onEventHover?: (nodeId: string | null) => void;
}

export interface ConsolidatedMessage {
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

export interface ToolCallCardProps {
	toolName: string;
	toolType?: string;
	status?: string;
	argumentsPreview?: string;
	filePath?: string;
	fileAction?: string;
}

export interface ReasoningTraceProps {
	content: string;
	isExpanded: boolean;
	onToggle: () => void;
	index: number;
}

export interface ResponseCardProps {
	content: string;
	tokenCount: number;
	isStreaming?: boolean;
	isHighlighted: boolean;
}

export interface StatsHeaderProps {
	messages: ConsolidatedMessage[];
}

export interface TurnHeaderProps {
	turnNumber: string;
}

export interface QueryCardProps {
	content: string;
}

export type { ReplayResponse, TimelineEvent };
