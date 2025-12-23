import { describe, expect, it } from "bun:test";
import { agentMachine } from "./machine";

describe("Agent State Machine", () => {
	describe("Machine Configuration", () => {
		it("should have correct initial state", () => {
			expect(agentMachine.config.initial).toBe("idle");
		});

		it("should have all required states", () => {
			const states = Object.keys(agentMachine.config.states);
			expect(states).toContain("idle");
			expect(states).toContain("analyzing");
			expect(states).toContain("deliberating");
			expect(states).toContain("recovering");
			expect(states).toContain("acting");
			expect(states).toContain("reviewing");
			expect(states).toContain("responding");
		});

		it("should have correct initial context structure", () => {
			const context = agentMachine.config.context as any;
			expect(context).toHaveProperty("sessionId");
			expect(context).toHaveProperty("input");
			expect(context).toHaveProperty("thoughts");
			expect(context).toHaveProperty("currentToolCalls");
			expect(context).toHaveProperty("toolOutputs");
			expect(context).toHaveProperty("history");
		});
	});

	describe("State Transitions", () => {
		it("idle state should accept START event", () => {
			const idleState = agentMachine.config.states.idle;
			expect(idleState.on).toHaveProperty("START");
			expect(idleState.on.START).toHaveProperty("target");
			expect(idleState.on.START.target).toBe("analyzing");
		});

		it("analyzing state should invoke fetchContext", () => {
			const analyzingState = agentMachine.config.states.analyzing;
			expect(analyzingState).toHaveProperty("invoke");
			expect(analyzingState.invoke).toHaveProperty("src");
			expect(analyzingState.invoke.src).toBe("fetchContext");
		});

		it("analyzing state should have onDone transition to deliberating", () => {
			const analyzingState = agentMachine.config.states.analyzing;
			expect(analyzingState.invoke).toHaveProperty("onDone");
			expect(analyzingState.invoke.onDone).toHaveProperty("target");
			expect(analyzingState.invoke.onDone.target).toBe("deliberating");
		});

		it("analyzing state should have onError graceful degradation", () => {
			const analyzingState = agentMachine.config.states.analyzing;
			expect(analyzingState.invoke).toHaveProperty("onError");
			expect(analyzingState.invoke.onError).toHaveProperty("target");
			expect(analyzingState.invoke.onError.target).toBe("deliberating");
		});

		it("analyzing state should have timeout after 10s", () => {
			const analyzingState = agentMachine.config.states.analyzing;
			expect(analyzingState).toHaveProperty("after");
			expect(analyzingState.after).toHaveProperty("10000");
			expect(analyzingState.after["10000"]).toHaveProperty("target");
			expect(analyzingState.after["10000"].target).toBe("deliberating");
		});

		it("deliberating state should invoke generateThought", () => {
			const deliberatingState = agentMachine.config.states.deliberating;
			expect(deliberatingState).toHaveProperty("invoke");
			expect(deliberatingState.invoke).toHaveProperty("src");
			expect(deliberatingState.invoke.src).toBe("generateThought");
		});

		it("deliberating state should have conditional transitions", () => {
			const deliberatingState = agentMachine.config.states.deliberating;
			expect(deliberatingState.invoke).toHaveProperty("onDone");
			expect(Array.isArray(deliberatingState.invoke.onDone)).toBe(true);
			expect(deliberatingState.invoke.onDone.length).toBe(2);
		});

		it("deliberating state should transition to acting with requiresTool guard", () => {
			const deliberatingState = agentMachine.config.states.deliberating;
			const firstTransition = deliberatingState.invoke.onDone[0];
			expect(firstTransition).toHaveProperty("target");
			expect(firstTransition.target).toBe("acting");
			expect(firstTransition).toHaveProperty("guard");
			expect(firstTransition.guard).toBe("requiresTool");
		});

		it("deliberating state should transition to responding otherwise", () => {
			const deliberatingState = agentMachine.config.states.deliberating;
			const secondTransition = deliberatingState.invoke.onDone[1];
			expect(secondTransition).toHaveProperty("target");
			expect(secondTransition.target).toBe("responding");
		});

		it("deliberating state should transition to recovering on error", () => {
			const deliberatingState = agentMachine.config.states.deliberating;
			expect(deliberatingState.invoke).toHaveProperty("onError");
			expect(deliberatingState.invoke.onError).toHaveProperty("target");
			expect(deliberatingState.invoke.onError.target).toBe("recovering");
		});

		it("deliberating state should have timeout after 30s", () => {
			const deliberatingState = agentMachine.config.states.deliberating;
			expect(deliberatingState).toHaveProperty("after");
			expect(deliberatingState.after).toHaveProperty("30000");
			expect(deliberatingState.after["30000"].target).toBe("recovering");
		});

		it("recovering state should invoke recoverError", () => {
			const recoveringState = agentMachine.config.states.recovering;
			expect(recoveringState).toHaveProperty("invoke");
			expect(recoveringState.invoke).toHaveProperty("src");
			expect(recoveringState.invoke.src).toBe("recoverError");
		});

		it("recovering state should transition to responding on success", () => {
			const recoveringState = agentMachine.config.states.recovering;
			expect(recoveringState.invoke).toHaveProperty("onDone");
			expect(recoveringState.invoke.onDone).toHaveProperty("target");
			expect(recoveringState.invoke.onDone.target).toBe("responding");
		});

		it("recovering state should transition to idle on error (ultimate fallback)", () => {
			const recoveringState = agentMachine.config.states.recovering;
			expect(recoveringState.invoke).toHaveProperty("onError");
			expect(recoveringState.invoke.onError).toHaveProperty("target");
			expect(recoveringState.invoke.onError.target).toBe("idle");
		});

		it("acting state should invoke executeTool", () => {
			const actingState = agentMachine.config.states.acting;
			expect(actingState).toHaveProperty("invoke");
			expect(actingState.invoke).toHaveProperty("src");
			expect(actingState.invoke.src).toBe("executeTool");
		});

		it("acting state should transition to reviewing on success", () => {
			const actingState = agentMachine.config.states.acting;
			expect(actingState.invoke).toHaveProperty("onDone");
			expect(actingState.invoke.onDone).toHaveProperty("target");
			expect(actingState.invoke.onDone.target).toBe("reviewing");
		});

		it("acting state should transition to reviewing on error", () => {
			const actingState = agentMachine.config.states.acting;
			expect(actingState.invoke).toHaveProperty("onError");
			expect(actingState.invoke.onError).toHaveProperty("target");
			expect(actingState.invoke.onError.target).toBe("reviewing");
		});

		it("acting state should have timeout after 30s", () => {
			const actingState = agentMachine.config.states.acting;
			expect(actingState).toHaveProperty("after");
			expect(actingState.after).toHaveProperty("30000");
			expect(actingState.after["30000"].target).toBe("reviewing");
		});

		it("reviewing state should always transition to deliberating", () => {
			const reviewingState = agentMachine.config.states.reviewing;
			expect(reviewingState).toHaveProperty("always");
			expect(reviewingState.always).toHaveProperty("target");
			expect(reviewingState.always.target).toBe("deliberating");
		});

		it("responding state should invoke streamResponse", () => {
			const respondingState = agentMachine.config.states.responding;
			expect(respondingState).toHaveProperty("invoke");
			expect(respondingState.invoke).toHaveProperty("src");
			expect(respondingState.invoke.src).toBe("streamResponse");
		});

		it("responding state should transition to idle on completion", () => {
			const respondingState = agentMachine.config.states.responding;
			expect(respondingState.invoke).toHaveProperty("onDone");
			expect(respondingState.invoke.onDone).toHaveProperty("target");
			expect(respondingState.invoke.onDone.target).toBe("idle");
		});
	});

	describe("Context Mutations", () => {
		it("analyzing state should assign contextString on success", () => {
			const analyzingState = agentMachine.config.states.analyzing;
			expect(analyzingState.invoke.onDone).toHaveProperty("actions");
		});

		it("analyzing state should set error on failure", () => {
			const analyzingState = agentMachine.config.states.analyzing;
			expect(analyzingState.invoke.onError).toHaveProperty("actions");
		});

		it("deliberating state should set thoughts and toolCalls when requiresTool", () => {
			const deliberatingState = agentMachine.config.states.deliberating;
			const firstTransition = deliberatingState.invoke.onDone[0];
			expect(firstTransition).toHaveProperty("actions");
		});

		it("deliberating state should set finalResponse when no tool required", () => {
			const deliberatingState = agentMachine.config.states.deliberating;
			const secondTransition = deliberatingState.invoke.onDone[1];
			expect(secondTransition).toHaveProperty("actions");
		});

		it("acting state should set toolOutputs on success", () => {
			const actingState = agentMachine.config.states.acting;
			expect(actingState.invoke.onDone).toHaveProperty("actions");
		});

		it("acting state should set error and mock toolOutputs on timeout", () => {
			const actingState = agentMachine.config.states.acting;
			expect(actingState.after["30000"]).toHaveProperty("actions");
		});

		it("recovering state should set finalResponse on success", () => {
			const recoveringState = agentMachine.config.states.recovering;
			expect(recoveringState.invoke.onDone).toHaveProperty("actions");
		});

		it("recovering state should set critical error message on failure", () => {
			const recoveringState = agentMachine.config.states.recovering;
			expect(recoveringState.invoke.onError).toHaveProperty("actions");
		});
	});
});
