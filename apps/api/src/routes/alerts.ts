import type { Logger } from "@engram/logger";
import type { PostgresClient } from "@engram/storage";
import { Hono } from "hono";
import { z } from "zod";
import { requireScopes } from "../middleware/scopes";

export interface AlertsRoutesOptions {
	postgresClient: PostgresClient;
	logger: Logger;
}

// Schemas
const AlertRuleSchema = z.object({
	name: z.string().min(1).max(100),
	metric: z.string().min(1),
	condition: z.enum(["greater_than", "less_than", "equals"]),
	threshold: z.number(),
	duration: z.number().int().min(1),
	severity: z.enum(["critical", "warning", "info"]),
	channels: z.array(z.string()),
});

const ChannelSchema = z.object({
	name: z.string().min(1).max(100),
	type: z.enum(["slack", "email", "webhook", "pagerduty"]),
	config: z.record(z.string(), z.string()),
});

// In-memory storage (would be PostgreSQL tables in production)
interface AlertRule {
	id: string;
	name: string;
	metric: string;
	condition: "greater_than" | "less_than" | "equals";
	threshold: number;
	duration: number;
	severity: "critical" | "warning" | "info";
	enabled: boolean;
	status: "active" | "triggered" | "muted";
	channels: string[];
	lastTriggered?: number;
	createdAt: number;
}

interface NotificationChannel {
	id: string;
	name: string;
	type: "slack" | "email" | "webhook" | "pagerduty";
	config: Record<string, string>;
	verified: boolean;
	createdAt: number;
}

interface AlertHistoryItem {
	id: string;
	ruleId: string;
	ruleName: string;
	severity: "critical" | "warning" | "info";
	state: "firing" | "resolved";
	triggeredAt: number;
	resolvedAt?: number;
	acknowledged: boolean;
	acknowledgedBy?: string;
}

// In-memory stores (replace with PostgreSQL in production)
const alertRules: Map<string, AlertRule> = new Map([
	[
		"rule-1",
		{
			id: "rule-1",
			name: "High Latency",
			metric: "latency",
			condition: "greater_than",
			threshold: 500,
			duration: 300,
			severity: "critical",
			enabled: true,
			status: "active",
			channels: ["ch-1", "ch-2"],
			lastTriggered: Date.now() - 7200000,
			createdAt: Date.now() - 86400000 * 30,
		},
	],
	[
		"rule-2",
		{
			id: "rule-2",
			name: "Error Rate Spike",
			metric: "error_rate",
			condition: "greater_than",
			threshold: 5,
			duration: 60,
			severity: "warning",
			enabled: true,
			status: "triggered",
			channels: ["ch-1"],
			lastTriggered: Date.now() - 300000,
			createdAt: Date.now() - 86400000 * 15,
		},
	],
	[
		"rule-3",
		{
			id: "rule-3",
			name: "Memory Pressure",
			metric: "memory",
			condition: "greater_than",
			threshold: 90,
			duration: 600,
			severity: "warning",
			enabled: false,
			status: "muted",
			channels: ["ch-3"],
			createdAt: Date.now() - 86400000 * 5,
		},
	],
]);

const notificationChannels: Map<string, NotificationChannel> = new Map([
	[
		"ch-1",
		{
			id: "ch-1",
			name: "Engineering Slack",
			type: "slack" as const,
			config: { webhookUrl: "https://hooks.slack.com/...", channel: "eng-alerts" } as Record<
				string,
				string
			>,
			verified: true,
			createdAt: Date.now() - 86400000 * 30,
		},
	],
	[
		"ch-2",
		{
			id: "ch-2",
			name: "On-Call Email",
			type: "email" as const,
			config: { emails: "oncall@example.com, team@example.com" } as Record<string, string>,
			verified: true,
			createdAt: Date.now() - 86400000 * 15,
		},
	],
	[
		"ch-3",
		{
			id: "ch-3",
			name: "PagerDuty",
			type: "pagerduty" as const,
			config: { routingKey: "abc123xyz789" } as Record<string, string>,
			verified: false,
			createdAt: Date.now() - 86400000 * 5,
		},
	],
]);

const alertHistory: AlertHistoryItem[] = [
	{
		id: "hist-1",
		ruleId: "rule-2",
		ruleName: "Error Rate Spike",
		severity: "warning",
		state: "firing",
		triggeredAt: Date.now() - 300000,
		acknowledged: false,
	},
	{
		id: "hist-2",
		ruleId: "rule-1",
		ruleName: "High Latency",
		severity: "critical",
		state: "resolved",
		triggeredAt: Date.now() - 7200000,
		resolvedAt: Date.now() - 3600000,
		acknowledged: true,
		acknowledgedBy: "chris@cheney.dev",
	},
	{
		id: "hist-3",
		ruleId: "rule-1",
		ruleName: "High Latency",
		severity: "critical",
		state: "resolved",
		triggeredAt: Date.now() - 86400000,
		resolvedAt: Date.now() - 86400000 + 1800000,
		acknowledged: true,
	},
];

function generateId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAlertsRoutes(options: AlertsRoutesOptions) {
	const { logger } = options;
	const app = new Hono();

	// ========================================
	// Alert Rules CRUD
	// ========================================

	// GET /v1/alerts/rules - List all rules
	app.get("/rules", requireScopes("alerts:read"), async (c) => {
		const rules = Array.from(alertRules.values()).sort((a, b) => b.createdAt - a.createdAt);

		return c.json({
			success: true,
			data: { rules },
			meta: {
				total: rules.length,
				timestamp: Date.now(),
			},
		});
	});

	// POST /v1/alerts/rules - Create rule
	app.post("/rules", requireScopes("alerts:write"), async (c) => {
		try {
			const body = await c.req.json();
			const parsed = AlertRuleSchema.safeParse(body);

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

			const id = `rule-${generateId()}`;
			const rule: AlertRule = {
				id,
				...parsed.data,
				enabled: true,
				status: "active",
				createdAt: Date.now(),
			};

			alertRules.set(id, rule);
			logger.info({ ruleId: id, name: rule.name }, "Alert rule created");

			return c.json({
				success: true,
				data: { id },
				meta: { timestamp: Date.now() },
			});
		} catch (error) {
			logger.error({ error }, "Error creating alert rule");
			throw error;
		}
	});

	// PATCH /v1/alerts/rules/:id - Update rule
	app.patch("/rules/:id", requireScopes("alerts:write"), async (c) => {
		try {
			const id = c.req.param("id");
			const rule = alertRules.get(id);

			if (!rule) {
				return c.json(
					{
						success: false,
						error: { code: "NOT_FOUND", message: "Alert rule not found" },
					},
					404,
				);
			}

			const body = await c.req.json();
			const updates = AlertRuleSchema.partial().safeParse(body);

			if (!updates.success) {
				return c.json(
					{
						success: false,
						error: {
							code: "VALIDATION_ERROR",
							message: "Invalid request body",
							details: updates.error.issues,
						},
					},
					400,
				);
			}

			// Handle enabled/status updates
			if ("enabled" in body) {
				rule.enabled = body.enabled;
				rule.status = body.enabled ? "active" : "muted";
			}

			// Apply other updates
			Object.assign(rule, updates.data);
			alertRules.set(id, rule);

			logger.info({ ruleId: id }, "Alert rule updated");

			return c.json({
				success: true,
				meta: { timestamp: Date.now() },
			});
		} catch (error) {
			logger.error({ error }, "Error updating alert rule");
			throw error;
		}
	});

	// DELETE /v1/alerts/rules/:id - Delete rule
	app.delete("/rules/:id", requireScopes("alerts:write"), async (c) => {
		const id = c.req.param("id");

		if (!alertRules.has(id)) {
			return c.json(
				{
					success: false,
					error: { code: "NOT_FOUND", message: "Alert rule not found" },
				},
				404,
			);
		}

		alertRules.delete(id);
		logger.info({ ruleId: id }, "Alert rule deleted");

		return c.json({
			success: true,
			meta: { timestamp: Date.now() },
		});
	});

	// ========================================
	// Notification Channels CRUD
	// ========================================

	// GET /v1/alerts/channels - List all channels
	app.get("/channels", requireScopes("alerts:read"), async (c) => {
		const channels = Array.from(notificationChannels.values()).sort(
			(a, b) => b.createdAt - a.createdAt,
		);

		return c.json({
			success: true,
			data: { channels },
			meta: {
				total: channels.length,
				timestamp: Date.now(),
			},
		});
	});

	// POST /v1/alerts/channels - Create channel
	app.post("/channels", requireScopes("alerts:write"), async (c) => {
		try {
			const body = await c.req.json();
			const parsed = ChannelSchema.safeParse(body);

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

			const id = `ch-${generateId()}`;
			const channel: NotificationChannel = {
				id,
				...parsed.data,
				verified: false,
				createdAt: Date.now(),
			};

			notificationChannels.set(id, channel);
			logger.info({ channelId: id, name: channel.name }, "Notification channel created");

			return c.json({
				success: true,
				data: { id },
				meta: { timestamp: Date.now() },
			});
		} catch (error) {
			logger.error({ error }, "Error creating notification channel");
			throw error;
		}
	});

	// POST /v1/alerts/channels/:id/test - Test channel
	app.post("/channels/:id/test", requireScopes("alerts:write"), async (c) => {
		const id = c.req.param("id");
		const channel = notificationChannels.get(id);

		if (!channel) {
			return c.json(
				{
					success: false,
					error: { code: "NOT_FOUND", message: "Channel not found" },
				},
				404,
			);
		}

		// In production, this would actually send a test notification
		logger.info({ channelId: id, type: channel.type }, "Test notification sent");

		// Mark as verified
		channel.verified = true;
		notificationChannels.set(id, channel);

		return c.json({
			success: true,
			data: {
				message: `Test notification sent to ${channel.type} channel "${channel.name}"`,
			},
			meta: { timestamp: Date.now() },
		});
	});

	// DELETE /v1/alerts/channels/:id - Delete channel
	app.delete("/channels/:id", requireScopes("alerts:write"), async (c) => {
		const id = c.req.param("id");

		if (!notificationChannels.has(id)) {
			return c.json(
				{
					success: false,
					error: { code: "NOT_FOUND", message: "Channel not found" },
				},
				404,
			);
		}

		notificationChannels.delete(id);
		logger.info({ channelId: id }, "Notification channel deleted");

		return c.json({
			success: true,
			meta: { timestamp: Date.now() },
		});
	});

	// ========================================
	// Alert History
	// ========================================

	// GET /v1/alerts/history - Get alert history
	app.get("/history", requireScopes("alerts:read"), async (c) => {
		const limit = Number.parseInt(c.req.query("limit") || "50", 10);

		const alerts = alertHistory.slice(0, limit);

		return c.json({
			success: true,
			data: { alerts },
			meta: {
				total: alertHistory.length,
				returned: alerts.length,
				timestamp: Date.now(),
			},
		});
	});

	// POST /v1/alerts/history/:id/acknowledge - Acknowledge alert
	app.post("/history/:id/acknowledge", requireScopes("alerts:write"), async (c) => {
		const id = c.req.param("id");
		const alert = alertHistory.find((a) => a.id === id);

		if (!alert) {
			return c.json(
				{
					success: false,
					error: { code: "NOT_FOUND", message: "Alert not found" },
				},
				404,
			);
		}

		alert.acknowledged = true;
		alert.acknowledgedBy = "console-user"; // Would use actual user from auth

		logger.info({ alertId: id }, "Alert acknowledged");

		return c.json({
			success: true,
			meta: { timestamp: Date.now() },
		});
	});

	return app;
}
