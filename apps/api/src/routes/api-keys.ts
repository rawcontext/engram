import type { Logger } from "@engram/logger";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiKeyRepository } from "../db/api-keys";
import type { ApiKeyContext } from "../middleware/auth";

type Env = {
	Variables: {
		apiKey: ApiKeyContext;
	};
};

// Request schemas
const RevokeApiKeySchema = z.object({
	keyId: z.string().min(1),
});

export interface ApiKeyRoutesOptions {
	apiKeyRepo: ApiKeyRepository;
	logger: Logger;
}

export function createApiKeyRoutes(options: ApiKeyRoutesOptions) {
	const { apiKeyRepo, logger } = options;
	const app = new Hono<Env>();

	// GET /v1/keys - List API keys for the authenticated user
	app.get("/", async (c) => {
		try {
			const apiKey = c.get("apiKey") as ApiKeyContext;

			// If no userId on the API key, can't list keys
			if (!apiKey.userId) {
				return c.json(
					{
						success: false,
						error: {
							code: "FORBIDDEN",
							message: "API key is not associated with a user",
						},
					},
					403,
				);
			}

			const keys = await apiKeyRepo.listByUser(apiKey.userId);

			// Don't expose sensitive data like key_hash
			const sanitizedKeys = keys.map((key) => ({
				id: key.id,
				keyPrefix: key.keyPrefix,
				keyType: key.keyType,
				name: key.name,
				description: key.description,
				scopes: key.scopes,
				rateLimitRpm: key.rateLimitRpm,
				isActive: key.isActive,
				expiresAt: key.expiresAt,
				createdAt: key.createdAt,
				updatedAt: key.updatedAt,
				lastUsedAt: key.lastUsedAt,
			}));

			return c.json({
				success: true,
				data: { keys: sanitizedKeys },
				meta: {
					usage: { operation: "list_keys", count: sanitizedKeys.length },
				},
			});
		} catch (error) {
			logger.error({ error }, "Error listing API keys");
			throw error;
		}
	});

	// POST /v1/keys/revoke - Revoke an API key
	app.post("/revoke", async (c) => {
		try {
			const body = await c.req.json();
			const parsed = RevokeApiKeySchema.safeParse(body);

			if (!parsed.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid request body",
							details: parsed.error.issues,
						},
					},
					400,
				);
			}

			const apiKey = c.get("apiKey") as ApiKeyContext;

			// Verify ownership: can only revoke keys for your own user
			if (!apiKey.userId) {
				return c.json(
					{
						success: false,
						error: {
							code: "FORBIDDEN",
							message: "API key is not associated with a user",
						},
					},
					403,
				);
			}

			// Check if the key belongs to the user
			const keys = await apiKeyRepo.listByUser(apiKey.userId);
			const keyToRevoke = keys.find((k) => k.id === parsed.data.keyId);

			if (!keyToRevoke) {
				return c.json(
					{
						success: false,
						error: {
							code: "NOT_FOUND",
							message: "API key not found or you don't have permission to revoke it",
						},
					},
					404,
				);
			}

			await apiKeyRepo.revoke(parsed.data.keyId);

			return c.json({
				success: true,
				data: { keyId: parsed.data.keyId, revoked: true },
				meta: {
					usage: { operation: "revoke_key" },
				},
			});
		} catch (error) {
			logger.error({ error }, "Error revoking API key");
			throw error;
		}
	});

	return app;
}
