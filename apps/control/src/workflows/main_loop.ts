import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

const thinkStep = createStep({
	id: "think",
	inputSchema: z.object({}),
	outputSchema: z.object({ thought: z.string() }),
	execute: async () => {
		return { thought: "I should check the memory." };
	},
});

const actStep = createStep({
	id: "act",
	inputSchema: z.object({ thought: z.string() }),
	outputSchema: z.object({ observation: z.string() }),
	execute: async () => {
		return { observation: "Memory says X." };
	},
});

// Workflow
export const mainLoop = createWorkflow({
	id: "main-loop",
	inputSchema: z.object({}),
	outputSchema: z.object({}),
})
	.then(thinkStep)
	.then(actStep)
	.commit();
