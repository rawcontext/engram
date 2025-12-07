import { Mastra } from "@mastra/core";
import { mainLoop } from "./workflows/main_loop";

export const config = {
  name: "soul-control",
  workflows: { mainLoop }, // Changed from array to Record<string, Workflow> based on type error hints
  agents: {},
};

export const mastra = new Mastra(config);
