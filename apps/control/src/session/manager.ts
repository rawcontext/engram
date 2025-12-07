import { DecisionEngine } from "../engine/decision";
import type { ContextAssembler } from "../context/assembler";
import type { MultiMcpAdapter } from "../tools/mcp_client";
import { SessionInitializer } from "./initializer";
import type { FalkorClient } from "@the-soul/storage";
import { createNodeLogger } from "@the-soul/logger";

const logger = createNodeLogger({ service: "control-service", component: "session-manager" });

export class SessionManager {
  private sessions = new Map<string, DecisionEngine>();
  private initializer: SessionInitializer;

  constructor(
    private contextAssembler: ContextAssembler,
    private mcpAdapter: MultiMcpAdapter,
    falkor: FalkorClient
  ) {
    this.initializer = new SessionInitializer(falkor);
  }

  async handleInput(sessionId: string, input: string) {
    // 1. Ensure Session Exists in Graph
    await this.initializer.ensureSession(sessionId);

    // 2. Get or Create Engine (Actor)
    let engine = this.sessions.get(sessionId);
    if (!engine) {
      logger.info({ sessionId }, "Spawning new DecisionEngine");
      engine = new DecisionEngine(this.contextAssembler, this.mcpAdapter);
      engine.start();
      this.sessions.set(sessionId, engine);
    }

    // 3. Dispatch Input
    // Note: DecisionEngine.handleInput takes sessionId again, which is fine
    await engine.handleInput(sessionId, input);
  }
}
