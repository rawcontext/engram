import type { TimelineEvent } from "@lib/types";
import { type ConsolidatedMessage, MESSAGE_TYPES, type MessageType } from "../types";
import { cleanThinkingMarkers, isThinkingContent } from "./messageUtils";

export function consolidateTimeline(timeline: TimelineEvent[]): ConsolidatedMessage[] {
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
