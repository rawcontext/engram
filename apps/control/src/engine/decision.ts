import { xai } from "@ai-sdk/xai";
import { createNodeLogger } from "@engram/logger";
import { generateText, tool } from "ai";
import { createActor, fromPromise } from "xstate";
import { z } from "zod";
import type { ContextAssembler } from "../context/assembler";
import { type AgentContext, agentMachine, type ToolCall } from "../state/machine";
import type { MultiMcpAdapter } from "../tools/mcp_client";

const model = xai("grok-4-1-fast-reasoning");
const logger = createNodeLogger({
	service: "control-service",
	base: { component: "decision-engine" },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AiToolSet = Record<string, any>;

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

	constructor(
		private contextAssembler: ContextAssembler,
		private mcpAdapter: MultiMcpAdapter,
	) {
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

						// Get tools from MCP adapter and convert to AI SDK format
						let aiTools = this.cachedTools;
						try {
							const mcpTools = await this.mcpAdapter.listTools();
							aiTools = convertMcpToolsToAiSdk(mcpTools);
							this.cachedTools = aiTools; // Cache for subsequent calls
						} catch (e) {
							logger.warn({ err: e }, "Failed to fetch MCP tools, using cached or empty");
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

							logger.debug(
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
							logger.error({ err: e }, "generateText failed");
							throw e;
						}
					}),
					executeTool: fromPromise(async ({ input }) => {
						const ctx = input as AgentContext;
						const results = [];
						for (const call of ctx.currentToolCalls) {
							// Mastra Step execute expects { inputData: ... }
							// We use execute() directly on the step object?
							// createMastraStep returns a Step object.
							// .execute() on a Step object might not be public or simple?
							// It is `step.execute({ inputData })`.
							// We need to cast args to inputData.
							const step = this.mcpAdapter.createMastraStep(call.toolName);
							const executeStep = step as unknown as {
								execute: (opts: { inputData: unknown }) => Promise<unknown>;
							};
							const result = await executeStep.execute({ inputData: call.args });
							results.push(result);
						}
						return { toolOutputs: results };
					}),
					streamResponse: fromPromise(async ({ input }) => {
						const ctx = input as AgentContext;
						logger.info({ response: ctx.finalResponse }, "Agent Response");
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
					requiresTool: ({ context }) => {
						return context.currentToolCalls && context.currentToolCalls.length > 0;
					},
				},
			}),
		);
	}

	start() {
		this.actor.start();
	}

	async handleInput(sessionId: string, input: string) {
		this.actor.send({ type: "START", sessionId, input });
	}
}
