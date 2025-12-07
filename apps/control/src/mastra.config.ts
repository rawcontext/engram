
import { Mastra } from "@mastra/core";
import { mainLoop } from "./workflows/main_loop";

export const config = {
  name: "soul-control",
  workflows: [mainLoop],
  agents: [], // We use workflows to drive agents
};

export const mastra = new Mastra(config);
