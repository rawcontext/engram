import type { Logger } from "@engram/logger";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import type { OAuthTokenRepository } from "../db/oauth-tokens.js";
import type { LockInfo, StateRepository } from "../db/state.js";

interface StateRoutesOptions {
	stateRepo: StateRepository;
	oauthTokenRepo: OAuthTokenRepository;
	logger: Logger;
}

/**
 * HTTP backend routes for OpenTofu/Terraform remote state
 *
 * Uses Basic Auth where password is an OAuth token with state:write scope.
 * Set environment variables:
 *   TF_HTTP_USERNAME=tofu
 *   TF_HTTP_PASSWORD=engram_oauth_xxxxx
 *
 * Implements the HTTP backend protocol:
 * - GET /state - Get current state
 * - POST /state - Update state
 * - LOCK /state - Acquire lock (custom method, also accepts POST)
 * - UNLOCK /state - Release lock (custom method, also accepts POST/DELETE)
 */
export function createStateRoutes({ stateRepo, oauthTokenRepo, logger }: StateRoutesOptions) {
	const app = new Hono();
	const STATE_ID = "default"; // Single state for now, could be parameterized

	// Basic auth middleware - validates OAuth token and checks for state:write scope
	app.use(
		"*",
		basicAuth({
			verifyUser: async (_username, password, _c) => {
				// Password is the OAuth token
				const token = await oauthTokenRepo.validate(password);
				if (!token) {
					logger.warn("Invalid OAuth token for tofu state");
					return false;
				}
				if (!token.scopes.includes("state:write")) {
					logger.warn(
						{ tokenPrefix: token.accessTokenPrefix },
						"OAuth token missing state:write scope",
					);
					return false;
				}
				logger.debug({ tokenPrefix: token.accessTokenPrefix }, "Tofu state auth successful");
				return true;
			},
		}),
	);

	// GET /state - Retrieve current state
	app.get("/", async (c) => {
		logger.debug("Getting tofu state");

		const state = await stateRepo.get(STATE_ID);

		if (!state) {
			// Return 404 if no state exists (per HTTP backend protocol)
			return c.body(null, 404);
		}

		// Validate state has required version field (OpenTofu/Terraform requirement)
		const stateData = state.state as { version?: number };
		if (typeof stateData.version !== "number") {
			logger.warn("Invalid state format detected - missing version field, returning 404");
			// Delete the invalid state so it can be recreated properly
			await stateRepo.delete(STATE_ID);
			return c.body(null, 404);
		}

		return c.json(state.state);
	});

	// POST /state - Update state
	app.post("/", async (c) => {
		logger.debug("Updating tofu state");

		const body = await c.req.json();
		await stateRepo.put(STATE_ID, body);

		return c.json({ success: true });
	});

	// DELETE /state - Delete state (rarely used)
	app.delete("/", async (c) => {
		logger.debug("Deleting tofu state");

		await stateRepo.delete(STATE_ID);

		return c.json({ success: true });
	});

	// LOCK /state/lock - Acquire lock
	// OpenTofu uses LOCK method, but we also accept POST for compatibility
	app.post("/lock", async (c) => {
		const lockInfo = (await c.req.json()) as LockInfo;
		logger.debug({ lockId: lockInfo.ID, who: lockInfo.Who }, "Acquiring tofu state lock");

		const result = await stateRepo.lock(STATE_ID, lockInfo);

		if (result.success) {
			return c.json({ success: true });
		}

		// Lock conflict - return 423 Locked with existing lock info
		logger.warn({ existingLock: result.existingLock }, "State lock conflict");
		return c.json(result.existingLock, 423);
	});

	// Handle LOCK method (OpenTofu default)
	app.on("LOCK", "/lock", async (c) => {
		const lockInfo = (await c.req.json()) as LockInfo;
		logger.debug(
			{ lockId: lockInfo.ID, who: lockInfo.Who },
			"Acquiring tofu state lock (LOCK method)",
		);

		const result = await stateRepo.lock(STATE_ID, lockInfo);

		if (result.success) {
			return c.json({ success: true });
		}

		logger.warn({ existingLock: result.existingLock }, "State lock conflict");
		return c.json(result.existingLock, 423);
	});

	// UNLOCK /state/lock - Release lock
	// OpenTofu uses UNLOCK method, but we also accept POST/DELETE for compatibility
	app.post("/unlock", async (c) => {
		const lockInfo = (await c.req.json()) as LockInfo;
		logger.debug({ lockId: lockInfo.ID }, "Releasing tofu state lock");

		const result = await stateRepo.unlock(STATE_ID, lockInfo.ID);

		if (result.success) {
			return c.json({ success: true });
		}

		logger.warn({ existingLock: result.existingLock }, "State unlock failed - lock mismatch");
		return c.json(result.existingLock, 423);
	});

	app.delete("/lock", async (c) => {
		const lockInfo = (await c.req.json()) as LockInfo;
		logger.debug({ lockId: lockInfo.ID }, "Releasing tofu state lock (DELETE method)");

		const result = await stateRepo.unlock(STATE_ID, lockInfo.ID);

		if (result.success) {
			return c.json({ success: true });
		}

		return c.json(result.existingLock, 423);
	});

	// Handle UNLOCK method (OpenTofu default)
	app.on("UNLOCK", "/lock", async (c) => {
		const lockInfo = (await c.req.json()) as LockInfo;
		logger.debug({ lockId: lockInfo.ID }, "Releasing tofu state lock (UNLOCK method)");

		const result = await stateRepo.unlock(STATE_ID, lockInfo.ID);

		if (result.success) {
			return c.json({ success: true });
		}

		return c.json(result.existingLock, 423);
	});

	// Force unlock (admin) - requires special scope
	app.post("/force-unlock", async (c) => {
		logger.warn("Force unlocking tofu state");

		await stateRepo.forceUnlock(STATE_ID);

		return c.json({ success: true });
	});

	return app;
}
