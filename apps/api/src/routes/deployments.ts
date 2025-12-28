import type { Logger } from "@engram/logger";
import { Hono } from "hono";
import { requireScopes } from "../middleware/scopes";

export interface DeploymentsRoutesOptions {
	logger: Logger;
}

interface Deployment {
	id: string;
	status: "success" | "failed" | "in_progress" | "pending" | "cancelled";
	commitHash: string;
	commitMessage: string;
	branch: string;
	environment: "production" | "staging" | "development";
	duration?: number;
	deployedAt: number;
	deployedBy: string;
	version?: string;
}

// In-memory deployments store (would be GitHub API or database in production)
const deployments: Deployment[] = [
	{
		id: "dep-001",
		status: "success",
		commitHash: "1f4f46e",
		commitMessage: "fix(search): use engram_turns collection for turn search",
		branch: "main",
		environment: "production",
		duration: 142000,
		deployedAt: Date.now() - 3600000,
		deployedBy: "chris@cheney.dev",
		version: "v1.4.2",
	},
	{
		id: "dep-002",
		status: "success",
		commitHash: "368dbc4",
		commitMessage: "fix(ingestion): use event_id for NATS deduplication instead of sessionId",
		branch: "main",
		environment: "production",
		duration: 156000,
		deployedAt: Date.now() - 86400000,
		deployedBy: "chris@cheney.dev",
		version: "v1.4.1",
	},
	{
		id: "dep-003",
		status: "success",
		commitHash: "eb907d7",
		commitMessage: "feat(console): add Performance, Logs, and Deployments pages",
		branch: "main",
		environment: "staging",
		duration: 134000,
		deployedAt: Date.now() - 86400000 * 2,
		deployedBy: "chris@cheney.dev",
		version: "v1.4.0",
	},
	{
		id: "dep-004",
		status: "failed",
		commitHash: "c4a2fcf",
		commitMessage: "feat(console): add API client and EnvironmentSwitcher component",
		branch: "main",
		environment: "production",
		duration: 89000,
		deployedAt: Date.now() - 86400000 * 3,
		deployedBy: "ci@github.com",
	},
	{
		id: "dep-005",
		status: "success",
		commitHash: "1adc8d7",
		commitMessage: "feat(console): add environment context, OAuth auth, theme toggle",
		branch: "main",
		environment: "production",
		duration: 167000,
		deployedAt: Date.now() - 86400000 * 4,
		deployedBy: "chris@cheney.dev",
		version: "v1.3.5",
	},
	{
		id: "dep-006",
		status: "in_progress",
		commitHash: "2aa4de2",
		commitMessage: "fix(console): move Google Fonts import before tailwindcss",
		branch: "main",
		environment: "staging",
		deployedAt: Date.now() - 300000,
		deployedBy: "ci@github.com",
	},
];

export function createDeploymentsRoutes(options: DeploymentsRoutesOptions) {
	const { logger } = options;
	const app = new Hono();

	// GET /v1/deployments - List deployments
	app.get("/", requireScopes("deployments:read"), async (c) => {
		try {
			const environment = c.req.query("environment");
			const limit = Number.parseInt(c.req.query("limit") || "20", 10);

			let filtered = [...deployments];

			if (environment) {
				filtered = filtered.filter((d) => d.environment === environment);
			}

			filtered = filtered.slice(0, limit);

			return c.json({
				success: true,
				data: filtered,
				meta: {
					total: deployments.length,
					returned: filtered.length,
					timestamp: Date.now(),
				},
			});
		} catch (error) {
			logger.error({ error }, "Error fetching deployments");
			throw error;
		}
	});

	// GET /v1/deployments/:id - Get single deployment
	app.get("/:id", requireScopes("deployments:read"), async (c) => {
		const id = c.req.param("id");
		const deployment = deployments.find((d) => d.id === id);

		if (!deployment) {
			return c.json(
				{
					success: false,
					error: { code: "NOT_FOUND", message: "Deployment not found" },
				},
				404,
			);
		}

		return c.json({
			success: true,
			data: deployment,
			meta: { timestamp: Date.now() },
		});
	});

	// GET /v1/deployments/latest/:environment - Get latest deployment for environment
	app.get("/latest/:environment", requireScopes("deployments:read"), async (c) => {
		const environment = c.req.param("environment");
		const latest = deployments
			.filter((d) => d.environment === environment && d.status === "success")
			.sort((a, b) => b.deployedAt - a.deployedAt)[0];

		if (!latest) {
			return c.json(
				{
					success: false,
					error: { code: "NOT_FOUND", message: "No successful deployment found" },
				},
				404,
			);
		}

		return c.json({
			success: true,
			data: latest,
			meta: { timestamp: Date.now() },
		});
	});

	return app;
}
