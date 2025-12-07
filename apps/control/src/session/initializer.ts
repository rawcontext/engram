import type { FalkorClient } from "@the-soul/storage";
import { createNodeLogger } from "@the-soul/logger";

const logger = createNodeLogger({ service: "control-service", component: "session-initializer" });

export class SessionInitializer {
  constructor(private falkor: FalkorClient) {}

  /**
   * Ensures a Session node exists in the graph.
   * If it doesn't exist, it is created with the current timestamp.
   */
  async ensureSession(sessionId: string): Promise<void> {
    const checkQuery = `MATCH (s:Session {id: $id}) RETURN s`;
    const result = await this.falkor.query(checkQuery, { id: sessionId });

    if (Array.isArray(result) && result.length > 0) {
      // Session exists
      return;
    }

    const now = new Date().toISOString();
    const createQuery = `
      CREATE (s:Session {
        id: $id,
        created_at: $now,
        updated_at: $now,
        status: 'active'
      })
      RETURN s
    `;

    await this.falkor.query(createQuery, { id: sessionId, now });
    logger.info({ sessionId }, "Created new Session");
  }
}

