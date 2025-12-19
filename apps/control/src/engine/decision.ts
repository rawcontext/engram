import { xai } from "@ai-sdk/xai";
import { createNodeLogger, type Logger } from "@engram/logger";
import { generateText, tool } from "ai";
import { createActor, fromPromise } from "xstate";
import { z } from "zod";
import type { ContextAssembler } from "../context/assembler";
import { type AgentContext, agentMachine, type ToolCall } from "../state/machine";
import type { MultiMcpAdapter } from "../tools/mcp_client";
import type { ToolRouter } from "../tools/router";

const model = xai("grok-4-1-fast-reasoning");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AiToolSet = Record<string, any>;

/**
 * Common interface for tool adapters (MultiMcpAdapter or ToolRouter).
 */
export interface ToolAdapter {
	listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>>;
	callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Dependencies for DecisionEngine construction.
 * Supports dependency injection for testability.
 */
export interface DecisionEngineDeps {
	/** Context assembler for building agent context. Required. */
	contextAssembler: ContextAssembler;
	/** Tool adapter for tool access. Can be ToolRouter or MultiMcpAdapter. Required. */
	toolAdapter: ToolAdapter;
	/** Logger instance. Defaults to createNodeLogger. */
	logger?: Logger;
	/** @deprecated Use toolAdapter instead */
	mcpAdapter?: MultiMcpAdapter | ToolRouter;
}

/**
 * Convert MCP tools to AI SDK tool format.
 * MCP tools have name, description, and inputSchema (JSON Schema).
 * We use passthrough schema since MCP tool schemas are defined at runtime.
 */
function convertMcpToolsToAiSdk(
	mcpTools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
): AiToolSet {
	const aiTools: AiToolSet = {};

	for (const mcpTool of mcpTools) {
		// Use tool() with passthrough schema for dynamic MCP tools
		aiTools[mcpTool.name] = tool({
			description: mcpTool.description || `Execute ${mcpTool.name}`,
			inputSchema: z.object({}).passthrough(),
			// No execute - we handle tool execution in the state machine
		});
	}

	return aiTools;
}

/**
 * Extract tool calls from AI SDK result, handling various formats.
 * The result.toolCalls contains { toolName, args } objects.
 */
function extractToolCalls(result: { toolCalls?: unknown[] }): ToolCall[] {
	if (!result.toolCalls || !Array.isArray(result.toolCalls)) {
		return [];
	}

	const calls: ToolCall[] = [];

	for (const call of result.toolCalls) {
		if (typeof call === "object" && call !== null) {
			const toolCall = call as Record<string, unknown>;

			// AI SDK format: { toolName, args } or { toolName, input }
			const toolName = (toolCall.toolName as string) || (toolCall.name as string);
			const args =
				(toolCall.args as Record<string, unknown>) ||
				(toolCall.input as Record<string, unknown>) ||
				{};

			if (toolName) {
				calls.push({ toolName, args });
			}
		}
	}

	return calls;
}

export class DecisionEngine {
	private actor;
	private cachedTools: AiToolSet = {};
	private contextAssembler: ContextAssembler;
	private toolAdapter: ToolAdapter;
	private logger: Logger;

	/**
	 * Create a DecisionEngine with injectable dependencies.
	 * @param deps - Dependencies object.
	 */
	constructor(deps: DecisionEngineDeps);
	/** @deprecated Use DecisionEngineDeps object instead */
	constructor(contextAssembler: ContextAssembler, mcpAdapter: MultiMcpAdapter);
	constructor(
		depsOrAssembler: DecisionEngineDeps | ContextAssembler,
		mcpAdapterArg?: MultiMcpAdapter,
	) {
		if (
			"contextAssembler" in depsOrAssembler &&
			("toolAdapter" in depsOrAssembler || "mcpAdapter" in depsOrAssembler)
		) {
			// New deps object constructor
			const deps = depsOrAssembler as DecisionEngineDeps;
			this.contextAssembler = deps.contextAssembler;
			// Support both toolAdapter (new) and mcpAdapter (deprecated)
			this.toolAdapter = deps.toolAdapter ?? (deps.mcpAdapter as ToolAdapter);
			this.logger =
				deps.logger ??
				createNodeLogger({
					service: "control-service",
					base: { component: "decision-engine" },
				});
		} else {
			// Legacy constructor
			this.contextAssembler = depsOrAssembler as ContextAssembler;
			if (!mcpAdapterArg) throw new Error("mcpAdapter required for legacy constructor");
			this.toolAdapter = mcpAdapterArg as ToolAdapter;
			this.logger = createNodeLogger({
				service: "control-service",
				base: { component: "decision-engine" },
			});
		}

		this.actor = createActor(
			agentMachine.provide({
				actors: {
					fetchContext: fromPromise(async ({ input }) => {
						const ctx = input as AgentContext;
						const contextString = await this.contextAssembler.assembleContext(
							ctx.sessionId,
							ctx.input,
						);
						return { contextString };
					}),
					generateThought: fromPromise(async ({ input }) => {
						const ctx = input as AgentContext;

						// Get tools from tool adapter and convert to AI SDK format
						let aiTools = this.cachedTools;
						try {
							const tools = await this.toolAdapter.listTools();
							aiTools = convertMcpToolsToAiSdk(tools);
							this.cachedTools = aiTools; // Cache for subsequent calls
						} catch (e) {
							this.logger.warn({ err: e }, "Failed to fetch tools, using cached or empty");
						}

						const hasTools = Object.keys(aiTools).length > 0;

						try {
							const result = await generateText({
								model: model,
								system: ctx.contextString || undefined,
								prompt: ctx.input,
								...(hasTools && { tools: aiTools }),
							});

							// Extract tool calls with proper error handling
							const toolCalls = extractToolCalls(result);

							this.logger.debug(
								{
									text: result.text?.slice(0, 100),
									toolCallCount: toolCalls.length,
									finishReason: result.finishReason,
								},
								"Generated thought",
							);

							return {
								thought: result.text,
								toolCalls,
							};
						} catch (e) {
							this.logger.error({ err: e }, "generateText failed");
							throw e;
						}
					}),
					executeTool: fromPromise(async ({ input }) => {
						const ctx = input as AgentContext;
						const results = [];
						for (const call of ctx.currentToolCalls) {
							const result = await this.toolAdapter.callTool(call.toolName, call.args);
							results.push(result);
						}
						return { toolOutputs: results };
					}),
					streamResponse: fromPromise(async ({ input }) => {
						const ctx = input as AgentContext;
						this.logger.info({ response: ctx.finalResponse }, "Agent Response");
						return {};
					}),
					recoverError: fromPromise(async ({ input }) => {
						const ctx = input as AgentContext;
						// Simple recovery: Apologize and explain
						const recoveryResponse = `I encountered an error while processing your request: ${ctx.error || "Unknown error"}. I'm sorry for the inconvenience.`;

						// Future enhancement: Try a simplified prompt or different model here.

						return { recoveryResponse };
					}),
				},
				actions: {
					assignInput: ({ context, event }) => {
						if (event.type === "START") {
							context.input = event.input;
							context.sessionId = event.sessionId;
						}
					},
				},
				guards: {
					requiresTool: ({ event }) => {
						// In XState v5, guards are evaluated BEFORE actions run.
						// Access event.output directly to get the latest toolCalls.
						const toolCalls = event.output?.toolCalls;
						return Array.isArray(toolCalls) && toolCalls.length > 0;
					},
				},
			}),
		);
	}

	start() {
		this.actor.start();
	}

	/**
	 * Stop the decision engine actor.
	 * Call this during cleanup to free resources.
	 */
	stop() {
		this.actor.stop();
	}

	async handleInput(sessionId: string, input: string) {
		this.actor.send({ type: "START", sessionId, input });
	}
}

/**
 * Factory function for creating DecisionEngine instances.
 * Supports dependency injection for testability.
 *
 * @example
 * // Production usage
 * const engine = createDecisionEngine({
 *   contextAssembler: assembler,
 *   mcpAdapter: multiAdapter,
 * });
 *
 * @example
 * // Test usage (inject mocks)
 * const engine = createDecisionEngine({
 *   contextAssembler: mockAssembler,
 *   mcpAdapter: mockAdapter,
 *   logger: mockLogger,
 * });
 */
export function createDecisionEngine(deps: DecisionEngineDeps): DecisionEngine {
	return new DecisionEngine(deps);
}
