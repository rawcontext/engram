import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createActor, fromPromise } from "xstate";
import type { ContextAssembler } from "../context/assembler";
import { type AgentContext, agentMachine } from "../state/machine";
import type { MultiMcpAdapter } from "../tools/mcp_client";
import { createNodeLogger } from "@the-soul/logger";

const mockModel = openai("gpt-4-turbo");
const logger = createNodeLogger({ service: "control-service", component: "decision-engine" });

export class DecisionEngine {
	private actor;

	constructor(
		private contextAssembler: ContextAssembler,
		private mcpAdapter: MultiMcpAdapter,
	) {
		this.actor = createActor(
			agentMachine.provide({
				actors: {
					fetchContext: fromPromise(async ({ input }) => {
						// input comes from machine invocation?
						// XState invoke input mapping needed or access context directly if machine structure allows?
						// In V5 fromPromise receives { input }. But we need context.
						// We can use `fromPromise(({ input }) => ...)` where input is passed via `input: ({ context }) => ({ ... })` in the machine definition.
						// OR we can access it if we define it as a service that accepts context?
						// Wait, `agentMachine.provide` expects actors that match the `src`.
						// If `src` is string, we provide implementation.
						// If we use `fromPromise`, we need to ensure the machine passes the data we need as `input`.

						// Simplify: In V5, invoked actors don't automatically get `context`. They get `input`.
						// I need to update `machine.ts` to pass `input` to invokes.
						// OR I can use a callback actor that can read machine state? No.

						// Let's assume I update `machine.ts` to pass context as input.
						const ctx = input as AgentContext;
						const contextString = await this.contextAssembler.assembleContext(
							ctx.sessionId,
							ctx.input,
						);
						return { contextString };
					}),
					generateThought: fromPromise(async ({ input }) => {
						const ctx = input as AgentContext;
						// const tools = await this.mcpAdapter.listTools();

						const result = await generateText({
							model: mockModel,
							prompt: `${ctx.contextString || ""}\nUser: ${ctx.input}`,
						});

						const toolCalls = result.toolCalls || [];

						return {
							thought: result.text,
							toolCalls: toolCalls,
						};
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
							// Using 'any' to call execute as it might be typed strictly
							// biome-ignore lint/suspicious/noExplicitAny: Bypassing Mastra strict typing for dynamic tool
							const result = await (step as any).execute({ inputData: call.args });
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
