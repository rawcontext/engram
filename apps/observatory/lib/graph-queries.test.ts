import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Mock Setup
// =============================================================================

// Use vi.hoisted to create mocks that will be available during module hoisting
const { mockQuery, mockConnect, mockIsConnected, mockDisconnect } = vi.hoisted(() => ({
	mockQuery: vi.fn(),
	mockConnect: vi.fn(),
	mockIsConnected: vi.fn(),
	mockDisconnect: vi.fn(),
}));

// Mock the FalkorClient before importing the module under test
vi.mock("@engram/storage/falkor", () => {
	return {
		createFalkorClient: () => ({
			query: mockQuery,
			connect: mockConnect,
			isConnected: mockIsConnected,
			disconnect: mockDisconnect,
		}),
	};
});

// Import after mock is set up
import {
	EDGE_TYPES,
	getAllSessions,
	getSessionLineage,
	getSessionsForWebSocket,
	getSessionTimeline,
	type LineageData,
	type LineageLink,
	type LineageNode,
	type SessionListItem,
	type SessionsData,
	type TimelineData,
	type TimelineEvent,
} from "./graph-queries";

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Creates a mock FalkorDB Session node
 */
function createMockSessionNode(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		labels: ["Session"],
		properties: {
			id: "session-123",
			title: "Test Session",
			user_id: "user-1",
			started_at: Date.now() - 60000,
			last_event_at: Date.now(),
			preview: "Test preview",
			...overrides,
		},
	};
}

/**
 * Creates a mock FalkorDB Turn node
 */
function createMockTurnNode(sequence: number, overrides: Record<string, unknown> = {}) {
	return {
		id: 10 + sequence,
		labels: ["Turn"],
		properties: {
			id: `turn-${sequence}`,
			user_content: `User message ${sequence}`,
			assistant_preview: `Assistant response ${sequence}`,
			sequence_index: sequence,
			vt_start: Date.now() - (10 - sequence) * 1000,
			input_tokens: 100,
			output_tokens: 200,
			...overrides,
		},
	};
}

/**
 * Creates a mock FalkorDB Reasoning node
 */
function createMockReasoningNode(
	turnId: string,
	sequence: number,
	overrides: Record<string, unknown> = {},
) {
	return {
		id: 100 + sequence,
		labels: ["Reasoning"],
		properties: {
			id: `reasoning-${turnId}-${sequence}`,
			preview: `Thinking about ${turnId}`,
			content_hash: "abc123",
			sequence_index: sequence,
			...overrides,
		},
	};
}

/**
 * Creates a mock FalkorDB ToolCall node
 */
function createMockToolCallNode(
	turnId: string,
	sequence: number,
	overrides: Record<string, unknown> = {},
) {
	return {
		id: 200 + sequence,
		labels: ["ToolCall"],
		properties: {
			id: `toolcall-${turnId}-${sequence}`,
			tool_name: "Read",
			tool_type: "file",
			status: "success",
			arguments_preview: '{"file_path": "/test.ts"}',
			file_path: "/test.ts",
			file_action: "read",
			sequence_index: sequence,
			...overrides,
		},
	};
}

/**
 * Creates a mock FalkorDB edge
 */
function createMockEdge(
	sourceId: number,
	destId: number,
	type: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		id: sourceId * 1000 + destId,
		relationshipType: type,
		sourceId,
		destinationId: destId,
		properties: {},
		...overrides,
	};
}

// =============================================================================
// Test Suites
// =============================================================================

describe("graph-queries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	// =========================================================================
	// EDGE_TYPES Constants
	// =========================================================================
	describe("EDGE_TYPES", () => {
		it("should export all expected edge type constants", () => {
			expect(EDGE_TYPES).toEqual({
				HAS_TURN: "HAS_TURN",
				NEXT: "NEXT",
				CONTAINS: "CONTAINS",
				INVOKES: "INVOKES",
				TRIGGERS: "TRIGGERS",
				YIELDS: "YIELDS",
			});
		});
	});

	// =========================================================================
	// getSessionLineage
	// =========================================================================
	describe("getSessionLineage", () => {
		it("should return empty nodes and links when session not found", async () => {
			// Arrange
			mockQuery
				.mockResolvedValueOnce([]) // Main lineage query
				.mockResolvedValueOnce([]) // HAS_TURN query
				.mockResolvedValueOnce([]) // INVOKES query
				.mockResolvedValueOnce([]); // TRIGGERS query

			// Act
			const result = await getSessionLineage("non-existent-session");

			// Assert
			expect(result).toEqual<LineageData>({ nodes: [], links: [] });
			expect(mockConnect).toHaveBeenCalled();
		});

		it("should return session node when only session exists", async () => {
			// Arrange
			const sessionNode = createMockSessionNode();
			mockQuery
				.mockResolvedValueOnce([
					{
						s: sessionNode,
						path_nodes: null,
						path_edges: null,
					},
				])
				.mockResolvedValueOnce([]) // HAS_TURN
				.mockResolvedValueOnce([]) // INVOKES
				.mockResolvedValueOnce([]); // TRIGGERS

			// Act
			const result = await getSessionLineage("session-123");

			// Assert
			expect(result.nodes).toHaveLength(1);
			expect(result.nodes[0]).toMatchObject<Partial<LineageNode>>({
				id: "session-123",
				label: "Session",
				type: "session",
			});
			expect(result.links).toHaveLength(0);
		});

		it("should return session and turn nodes with HAS_TURN edge", async () => {
			// Arrange
			const sessionNode = createMockSessionNode();
			const turnNode = createMockTurnNode(1);

			mockQuery
				.mockResolvedValueOnce([
					{
						s: sessionNode,
						path_nodes: [
							{
								nodeId: 1,
								nodeLabels: ["Session"],
								nodeProps: sessionNode.properties,
							},
							{
								nodeId: 11,
								nodeLabels: ["Turn"],
								nodeProps: turnNode.properties,
							},
						],
						path_edges: [createMockEdge(1, 11, "HAS_TURN")],
					},
				])
				.mockResolvedValueOnce([
					{
						sourceId: "session-123",
						targetId: "turn-1",
						relType: "HAS_TURN",
					},
				])
				.mockResolvedValueOnce([]) // INVOKES
				.mockResolvedValueOnce([]); // TRIGGERS

			// Act
			const result = await getSessionLineage("session-123");

			// Assert
			expect(result.nodes).toHaveLength(2);
			expect(result.nodes.map((n) => n.id)).toContain("session-123");
			expect(result.nodes.map((n) => n.id)).toContain("turn-1");

			// Should have HAS_TURN edge (may come from path_edges or explicit query)
			expect(result.links.length).toBeGreaterThanOrEqual(1);
			expect(result.links.some((l) => l.type === "HAS_TURN")).toBe(true);
		});

		it("should handle complex lineage with reasoning and tool calls", async () => {
			// Arrange
			const sessionNode = createMockSessionNode();
			const turnNode = createMockTurnNode(1);
			const reasoningNode = createMockReasoningNode("turn-1", 1);
			const toolCallNode = createMockToolCallNode("turn-1", 1);

			mockQuery
				.mockResolvedValueOnce([
					{
						s: sessionNode,
						path_nodes: [
							{
								nodeId: 1,
								nodeLabels: ["Session"],
								nodeProps: sessionNode.properties,
							},
							{
								nodeId: 11,
								nodeLabels: ["Turn"],
								nodeProps: turnNode.properties,
							},
							{
								nodeId: 101,
								nodeLabels: ["Reasoning"],
								nodeProps: reasoningNode.properties,
							},
							{
								nodeId: 201,
								nodeLabels: ["ToolCall"],
								nodeProps: toolCallNode.properties,
							},
						],
						path_edges: [
							createMockEdge(1, 11, "HAS_TURN"),
							createMockEdge(11, 101, "CONTAINS"),
							createMockEdge(11, 201, "INVOKES"),
							createMockEdge(101, 201, "TRIGGERS"),
						],
					},
				])
				.mockResolvedValueOnce([
					{
						sourceId: "session-123",
						targetId: "turn-1",
						relType: "HAS_TURN",
					},
				])
				.mockResolvedValueOnce([
					{
						sourceId: "turn-1",
						targetId: "toolcall-turn-1-1",
						relType: "INVOKES",
					},
				])
				.mockResolvedValueOnce([
					{
						sourceId: "reasoning-turn-1-1",
						targetId: "toolcall-turn-1-1",
						relType: "TRIGGERS",
					},
				]);

			// Act
			const result = await getSessionLineage("session-123");

			// Assert
			expect(result.nodes).toHaveLength(4);
			expect(result.nodes.map((n) => n.type)).toEqual(
				expect.arrayContaining(["session", "turn", "reasoning", "toolcall"]),
			);
		});

		it("should deduplicate edges from multiple paths", async () => {
			// Arrange - same edge appears in multiple paths
			const sessionNode = createMockSessionNode();
			const turnNode = createMockTurnNode(1);

			const pathRow = {
				s: sessionNode,
				path_nodes: [
					{
						nodeId: 1,
						nodeLabels: ["Session"],
						nodeProps: sessionNode.properties,
					},
					{
						nodeId: 11,
						nodeLabels: ["Turn"],
						nodeProps: turnNode.properties,
					},
				],
				path_edges: [createMockEdge(1, 11, "HAS_TURN")],
			};

			mockQuery
				.mockResolvedValueOnce([pathRow, pathRow]) // Same path returned twice
				.mockResolvedValueOnce([
					{
						sourceId: "session-123",
						targetId: "turn-1",
						relType: "HAS_TURN",
					},
				])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionLineage("session-123");

			// Assert - edges should be deduplicated
			const hasTurnEdges = result.links.filter((l) => l.type === "HAS_TURN");
			expect(hasTurnEdges.length).toBe(1);
		});

		it("should add explicit edges not found in path traversal", async () => {
			// Arrange - Path traversal returns nodes but no edges,
			// so explicit queries add NEW edges to the result
			const sessionNode = createMockSessionNode();
			const turnNode = createMockTurnNode(1);
			const toolCallNode = createMockToolCallNode("turn-1", 1);
			const reasoningNode = createMockReasoningNode("turn-1", 1);

			mockQuery
				.mockResolvedValueOnce([
					{
						s: sessionNode,
						path_nodes: [
							{
								nodeId: 1,
								nodeLabels: ["Session"],
								nodeProps: sessionNode.properties,
							},
							{
								nodeId: 11,
								nodeLabels: ["Turn"],
								nodeProps: turnNode.properties,
							},
							{
								nodeId: 101,
								nodeLabels: ["Reasoning"],
								nodeProps: reasoningNode.properties,
							},
							{
								nodeId: 201,
								nodeLabels: ["ToolCall"],
								nodeProps: toolCallNode.properties,
							},
						],
						path_edges: [], // No edges from path traversal
					},
				])
				.mockResolvedValueOnce([
					// HAS_TURN edge - new, should be added
					{
						sourceId: "session-123",
						targetId: "turn-1",
						relType: "HAS_TURN",
					},
				])
				.mockResolvedValueOnce([
					// INVOKES edge - new, should be added
					{
						sourceId: "turn-1",
						targetId: "toolcall-turn-1-1",
						relType: "INVOKES",
					},
				])
				.mockResolvedValueOnce([
					// TRIGGERS edge - new, should be added
					{
						sourceId: "reasoning-turn-1-1",
						targetId: "toolcall-turn-1-1",
						relType: "TRIGGERS",
					},
				]);

			// Act
			const result = await getSessionLineage("session-123");

			// Assert - should have 3 edges from explicit queries
			expect(result.links).toHaveLength(3);
			expect(result.links.map((l) => l.type).sort()).toEqual(["HAS_TURN", "INVOKES", "TRIGGERS"]);
		});

		it("should handle edges with different property names", async () => {
			// Arrange - FalkorDB can return edges with various property names
			const sessionNode = createMockSessionNode();
			const turnNode = createMockTurnNode(1);

			mockQuery
				.mockResolvedValueOnce([
					{
						s: sessionNode,
						path_nodes: [
							{
								nodeId: 1,
								nodeLabels: ["Session"],
								nodeProps: sessionNode.properties,
							},
							{
								nodeId: 11,
								nodeLabels: ["Turn"],
								nodeProps: turnNode.properties,
							},
						],
						path_edges: [
							{
								id: 1,
								relation: "HAS_TURN", // Using 'relation' instead of 'relationshipType'
								srcNodeId: 1, // Using 'srcNodeId' instead of 'sourceId'
								destNodeId: 11, // Using 'destNodeId' instead of 'destinationId'
								properties: {},
							},
						],
					},
				])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionLineage("session-123");

			// Assert
			expect(result.links.length).toBeGreaterThanOrEqual(1);
			expect(result.links[0].type).toBe("HAS_TURN");
		});

		it("should handle nodes without id in properties", async () => {
			// Arrange
			const sessionNode = createMockSessionNode();

			mockQuery
				.mockResolvedValueOnce([
					{
						s: sessionNode,
						path_nodes: [
							{
								nodeId: 1,
								nodeLabels: ["Session"],
								nodeProps: sessionNode.properties,
							},
							{
								nodeId: 99,
								nodeLabels: ["Unknown"],
								nodeProps: {}, // No id property
							},
						],
						path_edges: [],
					},
				])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionLineage("session-123");

			// Assert - should only include node with valid id
			expect(result.nodes).toHaveLength(1);
			expect(result.nodes[0].id).toBe("session-123");
		});

		it("should handle null/undefined result arrays", async () => {
			// Arrange
			mockQuery
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionLineage("session-123");

			// Assert
			expect(result).toEqual<LineageData>({ nodes: [], links: [] });
		});
	});

	// =========================================================================
	// getSessionTimeline
	// =========================================================================
	describe("getSessionTimeline", () => {
		it("should return empty timeline when session has no turns", async () => {
			// Arrange
			mockQuery
				.mockResolvedValueOnce([]) // turns query
				.mockResolvedValueOnce([]) // reasoning query
				.mockResolvedValueOnce([]); // toolcall query

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			expect(result).toEqual<TimelineData>({ timeline: [] });
		});

		it("should return timeline with turn header and user query", async () => {
			// Arrange
			const turnNode = createMockTurnNode(1);

			mockQuery
				.mockResolvedValueOnce([{ t: turnNode }])
				.mockResolvedValueOnce([]) // no reasoning
				.mockResolvedValueOnce([]); // no tool calls

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			expect(result.timeline).toHaveLength(3); // header, query, response

			// Turn header
			expect(result.timeline[0]).toMatchObject<Partial<TimelineEvent>>({
				type: "turn",
				content: "Turn 1",
				turnIndex: 1,
				graphNodeId: "turn-1",
			});

			// User query
			expect(result.timeline[1]).toMatchObject<Partial<TimelineEvent>>({
				type: "thought",
				content: "User message 1",
			});

			// Assistant response
			expect(result.timeline[2]).toMatchObject<Partial<TimelineEvent>>({
				type: "response",
				content: "Assistant response 1",
				graphNodeId: "turn-1",
			});
		});

		it("should include reasoning events in timeline", async () => {
			// Arrange
			const turnNode = createMockTurnNode(1);
			const reasoningNode = createMockReasoningNode("turn-1", 1);

			mockQuery
				.mockResolvedValueOnce([{ t: turnNode }])
				.mockResolvedValueOnce([{ turnId: "turn-1", r: reasoningNode }])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			const thinkingEvents = result.timeline.filter(
				(e) => e.type === "thought" && String(e.content).includes("<thinking>"),
			);
			expect(thinkingEvents).toHaveLength(1);
			expect(thinkingEvents[0].content).toContain("Thinking about turn-1");
		});

		it("should include tool call events in timeline", async () => {
			// Arrange
			const turnNode = createMockTurnNode(1);
			const toolCallNode = createMockToolCallNode("turn-1", 1);

			mockQuery
				.mockResolvedValueOnce([{ t: turnNode }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ turnId: "turn-1", tc: toolCallNode }]);

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			const toolCallEvents = result.timeline.filter((e) => e.type === "toolcall");
			expect(toolCallEvents).toHaveLength(1);
			expect(toolCallEvents[0]).toMatchObject<Partial<TimelineEvent>>({
				type: "toolcall",
				content: "Read",
				toolName: "Read",
				toolType: "file",
				toolStatus: "success",
				filePath: "/test.ts",
				fileAction: "read",
			});
		});

		it("should handle multiple turns in sequence", async () => {
			// Arrange
			const turn1 = createMockTurnNode(1);
			const turn2 = createMockTurnNode(2);

			mockQuery
				.mockResolvedValueOnce([{ t: turn1 }, { t: turn2 }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			const turnHeaders = result.timeline.filter((e) => e.type === "turn");
			expect(turnHeaders).toHaveLength(2);
			expect(turnHeaders[0].content).toBe("Turn 1");
			expect(turnHeaders[1].content).toBe("Turn 2");
		});

		it("should handle turn without user content", async () => {
			// Arrange
			const turnNode = createMockTurnNode(1, { user_content: null });

			mockQuery
				.mockResolvedValueOnce([{ t: turnNode }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			const thoughtEvents = result.timeline.filter((e) => e.type === "thought");
			expect(thoughtEvents).toHaveLength(0);
		});

		it("should handle turn without assistant preview", async () => {
			// Arrange
			const turnNode = createMockTurnNode(1, { assistant_preview: null });

			mockQuery
				.mockResolvedValueOnce([{ t: turnNode }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			const responseEvents = result.timeline.filter((e) => e.type === "response");
			expect(responseEvents).toHaveLength(0);
		});

		it("should handle turn without vt_start timestamp", async () => {
			// Arrange
			const turnNode = createMockTurnNode(1, { vt_start: null });

			mockQuery
				.mockResolvedValueOnce([{ t: turnNode }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			expect(result.timeline.length).toBeGreaterThan(0);
			// Should use current timestamp as fallback
			expect(result.timeline[0].timestamp).toBeDefined();
		});

		it("should skip turns without properties", async () => {
			// Arrange
			mockQuery
				.mockResolvedValueOnce([{ t: { id: 1, labels: ["Turn"] } }]) // No properties
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			expect(result.timeline).toHaveLength(0);
		});

		it("should handle reasoning with content instead of preview", async () => {
			// Arrange
			const turnNode = createMockTurnNode(1);
			const reasoningNode = {
				id: 101,
				labels: ["Reasoning"],
				properties: {
					id: "reasoning-1",
					content: "Full reasoning content", // Using content instead of preview
					sequence_index: 1,
				},
			};

			mockQuery
				.mockResolvedValueOnce([{ t: turnNode }])
				.mockResolvedValueOnce([{ turnId: "turn-1", r: reasoningNode }])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			const thinkingEvents = result.timeline.filter(
				(e) => e.type === "thought" && String(e.content).includes("<thinking>"),
			);
			expect(thinkingEvents).toHaveLength(1);
			expect(thinkingEvents[0].content).toContain("Full reasoning content");
		});

		it("should skip reasoning without content or preview", async () => {
			// Arrange
			const turnNode = createMockTurnNode(1);
			const emptyReasoningNode = {
				id: 101,
				labels: ["Reasoning"],
				properties: {
					id: "reasoning-1",
					sequence_index: 1,
				},
			};

			mockQuery
				.mockResolvedValueOnce([{ t: turnNode }])
				.mockResolvedValueOnce([{ turnId: "turn-1", r: emptyReasoningNode }])
				.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			const thinkingEvents = result.timeline.filter(
				(e) => e.type === "thought" && String(e.content).includes("<thinking>"),
			);
			expect(thinkingEvents).toHaveLength(0);
		});

		it("should skip tool calls without tool_name", async () => {
			// Arrange
			const turnNode = createMockTurnNode(1);
			const emptyToolCall = {
				id: 201,
				labels: ["ToolCall"],
				properties: {
					id: "toolcall-1",
					sequence_index: 1,
				},
			};

			mockQuery
				.mockResolvedValueOnce([{ t: turnNode }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ turnId: "turn-1", tc: emptyToolCall }]);

			// Act
			const result = await getSessionTimeline("session-123");

			// Assert
			const toolCallEvents = result.timeline.filter((e) => e.type === "toolcall");
			expect(toolCallEvents).toHaveLength(0);
		});
	});

	// =========================================================================
	// getAllSessions
	// =========================================================================
	describe("getAllSessions", () => {
		it("should return empty sessions when no sessions exist", async () => {
			// Arrange
			mockQuery
				.mockResolvedValueOnce([]) // sessions query
				.mockResolvedValueOnce([{ total: 0 }]); // count query

			// Act
			const result = await getAllSessions({});

			// Assert
			expect(result).toMatchObject<SessionsData>({
				active: [],
				recent: [],
				sessions: [],
				pagination: {
					total: 0,
					limit: 50,
					offset: 0,
					hasMore: false,
				},
			});
		});

		it("should return sessions with default pagination", async () => {
			// Arrange
			const sessionNode = createMockSessionNode();

			mockQuery
				.mockResolvedValueOnce([{ s: sessionNode }]) // sessions query
				.mockResolvedValueOnce([{ cnt: 5 }]) // count for session
				.mockResolvedValueOnce([{ preview: "First message preview" }]) // preview for session
				.mockResolvedValueOnce([{ total: 1 }]); // total count

			// Act
			const result = await getAllSessions({});

			// Assert
			expect(result.sessions).toHaveLength(1);
			expect(result.sessions[0]).toMatchObject<Partial<SessionListItem>>({
				id: "session-123",
				title: "Test Session",
				userId: "user-1",
				eventCount: 5,
				preview: "First message preview",
			});
		});

		it("should respect limit and offset options", async () => {
			// Arrange
			mockQuery
				.mockResolvedValueOnce([]) // sessions query
				.mockResolvedValueOnce([{ total: 100 }]); // count query

			// Act
			const result = await getAllSessions({ limit: 10, offset: 20 });

			// Assert
			expect(result.pagination).toEqual({
				total: 100,
				limit: 10,
				offset: 20,
				hasMore: true,
			});
		});

		it("should classify active sessions based on threshold", async () => {
			// Arrange
			const now = Date.now();
			const activeSession = createMockSessionNode({
				id: "active-session",
				last_event_at: now - 30000, // 30 seconds ago
			});
			const inactiveSession = createMockSessionNode({
				id: "inactive-session",
				last_event_at: now - 120000, // 2 minutes ago
			});

			mockQuery
				.mockResolvedValueOnce([{ s: activeSession }, { s: inactiveSession }])
				.mockResolvedValueOnce([{ cnt: 1 }]) // count for active
				.mockResolvedValueOnce([{ preview: null }]) // preview for active
				.mockResolvedValueOnce([{ cnt: 2 }]) // count for inactive
				.mockResolvedValueOnce([{ preview: null }]) // preview for inactive
				.mockResolvedValueOnce([{ total: 2 }]);

			// Act
			const result = await getAllSessions({ activeThresholdMs: 60000 }); // 1 minute threshold

			// Assert
			expect(result.active).toHaveLength(1);
			expect(result.active[0].id).toBe("active-session");
			expect(result.recent).toHaveLength(1);
			expect(result.recent[0].id).toBe("inactive-session");
		});

		it("should truncate long previews", async () => {
			// Arrange
			const sessionNode = createMockSessionNode();
			const longPreview = "A".repeat(200);

			mockQuery
				.mockResolvedValueOnce([{ s: sessionNode }])
				.mockResolvedValueOnce([{ cnt: 1 }])
				.mockResolvedValueOnce([{ preview: longPreview }])
				.mockResolvedValueOnce([{ total: 1 }]);

			// Act
			const result = await getAllSessions({});

			// Assert
			expect(result.sessions[0].preview?.length).toBeLessThanOrEqual(153); // 150 + "..."
			expect(result.sessions[0].preview).toContain("...");
		});

		it("should handle session accessed via array index", async () => {
			// Arrange - FalkorDB sometimes returns results with numeric keys
			const sessionNode = createMockSessionNode();

			mockQuery
				.mockResolvedValueOnce([{ 0: sessionNode }]) // Numeric key instead of 's'
				.mockResolvedValueOnce([{ 0: 3 }]) // count with numeric key
				.mockResolvedValueOnce([{ 0: "Preview" }]) // preview with numeric key
				.mockResolvedValueOnce([{ 0: 1 }]); // total with numeric key

			// Act
			const result = await getAllSessions({});

			// Assert
			expect(result.sessions).toHaveLength(1);
			expect(result.sessions[0].id).toBe("session-123");
		});

		it("should handle session without last_event_at", async () => {
			// Arrange
			const sessionNode = createMockSessionNode({ last_event_at: null });

			mockQuery
				.mockResolvedValueOnce([{ s: sessionNode }])
				.mockResolvedValueOnce([{ cnt: 0 }])
				.mockResolvedValueOnce([{ preview: null }])
				.mockResolvedValueOnce([{ total: 1 }]);

			// Act
			const result = await getAllSessions({});

			// Assert
			expect(result.sessions[0].isActive).toBe(false);
			expect(result.sessions[0].lastEventAt).toBeNull();
		});

		it("should handle missing user_id", async () => {
			// Arrange
			const sessionNode = createMockSessionNode({ user_id: undefined });

			mockQuery
				.mockResolvedValueOnce([{ s: sessionNode }])
				.mockResolvedValueOnce([{ cnt: 0 }])
				.mockResolvedValueOnce([{ preview: null }])
				.mockResolvedValueOnce([{ total: 1 }]);

			// Act
			const result = await getAllSessions({});

			// Assert
			expect(result.sessions[0].userId).toBe("unknown");
		});

		it("should calculate hasMore correctly", async () => {
			// Arrange
			const sessionNode = createMockSessionNode();

			mockQuery
				.mockResolvedValueOnce([{ s: sessionNode }])
				.mockResolvedValueOnce([{ cnt: 0 }])
				.mockResolvedValueOnce([{ preview: null }])
				.mockResolvedValueOnce([{ total: 1 }]);

			// Act
			const result = await getAllSessions({ limit: 10, offset: 0 });

			// Assert
			expect(result.pagination?.hasMore).toBe(false); // 0 + 1 < 1 is false
		});

		it("should handle non-array result from query", async () => {
			// Arrange
			mockQuery
				.mockResolvedValueOnce(null) // Non-array sessions result
				.mockResolvedValueOnce([{ total: 0 }]);

			// Act
			const result = await getAllSessions({});

			// Assert
			expect(result.sessions).toHaveLength(0);
		});
	});

	// =========================================================================
	// getSessionsForWebSocket
	// =========================================================================
	describe("getSessionsForWebSocket", () => {
		it("should return empty active and recent when no sessions", async () => {
			// Arrange
			mockQuery.mockResolvedValueOnce([]);

			// Act
			const result = await getSessionsForWebSocket();

			// Assert
			expect(result).toEqual({ active: [], recent: [] });
		});

		it("should classify sessions as active or recent based on 5 minute threshold", async () => {
			// Arrange
			const now = Date.now();
			const activeSession = {
				id: 1,
				labels: ["Session"],
				properties: {
					id: "active-session",
					title: "Active",
					user_id: "user-1",
					started_at: now - 300000, // 5 min ago
					last_event_at: now - 60000, // 1 min ago
				},
			};
			const recentSession = {
				id: 2,
				labels: ["Session"],
				properties: {
					id: "recent-session",
					title: "Recent",
					user_id: "user-1",
					started_at: now - 600000, // 10 min ago
					last_event_at: now - 400000, // 6.6 min ago
				},
			};

			mockQuery.mockResolvedValueOnce([
				{ s: activeSession, eventCount: 5, lastEventAt: now - 60000 },
				{ s: recentSession, eventCount: 10, lastEventAt: now - 400000 },
			]);

			// Act
			const result = await getSessionsForWebSocket();

			// Assert
			expect(result.active).toHaveLength(1);
			expect(result.active[0].id).toBe("active-session");
			expect(result.recent).toHaveLength(1);
			expect(result.recent[0].id).toBe("recent-session");
		});

		it("should use default limit of 50", async () => {
			// Arrange
			mockQuery.mockResolvedValueOnce([]);

			// Act
			await getSessionsForWebSocket();

			// Assert
			expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("LIMIT"), { limit: 50 });
		});

		it("should respect custom limit", async () => {
			// Arrange
			mockQuery.mockResolvedValueOnce([]);

			// Act
			await getSessionsForWebSocket(25);

			// Assert
			expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("LIMIT"), { limit: 25 });
		});

		it("should use lastEventAt from row when session has no last_event_at", async () => {
			// Arrange
			const now = Date.now();
			const sessionNode = {
				id: 1,
				labels: ["Session"],
				properties: {
					id: "session-1",
					title: "Test",
					user_id: "user-1",
					started_at: now - 100000,
					// No last_event_at
				},
			};

			mockQuery.mockResolvedValueOnce([
				{ s: sessionNode, eventCount: 3, lastEventAt: now - 30000 },
			]);

			// Act
			const result = await getSessionsForWebSocket();

			// Assert
			expect(result.active).toHaveLength(1);
			expect(result.active[0].lastEventAt).toBe(now - 30000);
		});

		it("should fallback to started_at when no event times available", async () => {
			// Arrange
			const now = Date.now();
			const startedAt = now - 10000; // 10 seconds ago - should be active
			const sessionNode = {
				id: 1,
				labels: ["Session"],
				properties: {
					id: "session-1",
					title: "Test",
					user_id: "user-1",
					started_at: startedAt,
				},
			};

			mockQuery.mockResolvedValueOnce([{ s: sessionNode, eventCount: 0, lastEventAt: null }]);

			// Act
			const result = await getSessionsForWebSocket();

			// Assert
			expect(result.active).toHaveLength(1);
			expect(result.active[0].lastEventAt).toBe(startedAt);
		});

		it("should include eventCount from aggregation", async () => {
			// Arrange
			const sessionNode = createMockSessionNode();

			mockQuery.mockResolvedValueOnce([
				{ s: sessionNode, eventCount: 42, lastEventAt: Date.now() },
			]);

			// Act
			const result = await getSessionsForWebSocket();

			// Assert
			expect(result.active[0].eventCount).toBe(42);
		});

		it("should handle session without properties", async () => {
			// Arrange
			mockQuery.mockResolvedValueOnce([
				{ s: { id: 1, labels: ["Session"] }, eventCount: 0, lastEventAt: null },
			]);

			// Act
			const result = await getSessionsForWebSocket();

			// Assert
			expect(result.active).toHaveLength(0);
			expect(result.recent).toHaveLength(0);
		});
	});

	// =========================================================================
	// Error Handling
	// =========================================================================
	describe("error handling", () => {
		it("getSessionLineage should propagate query errors", async () => {
			// Arrange
			mockQuery.mockRejectedValueOnce(new Error("Database connection failed"));

			// Act & Assert
			await expect(getSessionLineage("session-123")).rejects.toThrow("Database connection failed");
		});

		it("getSessionTimeline should propagate query errors", async () => {
			// Arrange
			mockQuery.mockRejectedValueOnce(new Error("Query timeout"));

			// Act & Assert
			await expect(getSessionTimeline("session-123")).rejects.toThrow("Query timeout");
		});

		it("getAllSessions should propagate query errors", async () => {
			// Arrange
			mockQuery.mockRejectedValueOnce(new Error("Permission denied"));

			// Act & Assert
			await expect(getAllSessions({})).rejects.toThrow("Permission denied");
		});

		it("getSessionsForWebSocket should propagate query errors", async () => {
			// Arrange
			mockQuery.mockRejectedValueOnce(new Error("Network error"));

			// Act & Assert
			await expect(getSessionsForWebSocket()).rejects.toThrow("Network error");
		});
	});

	// =========================================================================
	// Type Exports
	// =========================================================================
	describe("type exports", () => {
		it("should export LineageNode type with expected shape", () => {
			const node: LineageNode = {
				id: "test-id",
				label: "Session",
				type: "session",
				customProp: "value",
			};
			expect(node.id).toBe("test-id");
			expect(node.label).toBe("Session");
		});

		it("should export LineageLink type with expected shape", () => {
			const link: LineageLink = {
				source: "node-1",
				target: "node-2",
				type: "HAS_TURN",
				properties: { weight: 1 },
			};
			expect(link.source).toBe("node-1");
			expect(link.type).toBe("HAS_TURN");
		});

		it("should export TimelineEvent type with expected shape", () => {
			const event: TimelineEvent = {
				id: "event-1",
				type: "turn",
				content: "Turn 1",
				timestamp: new Date().toISOString(),
			};
			expect(event.id).toBe("event-1");
		});

		it("should export SessionListItem type with expected shape", () => {
			const session: SessionListItem = {
				id: "session-1",
				title: "Test",
				userId: "user-1",
				startedAt: Date.now(),
				lastEventAt: Date.now(),
				eventCount: 5,
				preview: "Preview text",
				isActive: true,
			};
			expect(session.id).toBe("session-1");
		});
	});
});
