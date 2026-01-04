/**
 * Webhook Notifier Service
 *
 * Sends notifications to external webhooks when events occur.
 * Supports conflict notifications with configurable URLs per org.
 */

import type { Logger } from "@engram/logger";

// =============================================================================
// Types
// =============================================================================

/**
 * Conflict summary for webhook notification
 */
export interface ConflictSummary {
	/** Memory A ID */
	memoryIdA: string;
	/** Memory B ID */
	memoryIdB: string;
	/** Type of conflict */
	relation: "contradiction" | "supersedes" | "augments" | "duplicate";
	/** Confidence score (0-1) */
	confidence: number;
	/** Human-readable reasoning */
	reasoning: string;
	/** Suggested action */
	suggestedAction: "invalidate_a" | "invalidate_b" | "keep_both" | "merge";
}

/**
 * Payload sent to conflict webhooks
 */
export interface ConflictWebhookPayload {
	/** Event type */
	event: "conflicts_detected";
	/** Timestamp when conflicts were detected */
	timestamp: string;
	/** Project where conflicts were found */
	project: string;
	/** Organization ID */
	orgId: string;
	/** Scan identifier */
	scanId: string;
	/** Total number of conflicts detected */
	count: number;
	/** Summary of each conflict */
	conflicts: ConflictSummary[];
	/** Link to review conflicts (Observatory URL) */
	reviewUrl?: string;
}

/**
 * Webhook configuration for an organization
 */
export interface OrgWebhookConfig {
	/** Webhook URL to POST to */
	url: string;
	/** Optional secret for HMAC signature */
	secret?: string;
	/** Whether webhook is enabled */
	enabled: boolean;
}

/**
 * Options for WebhookNotifier
 */
export interface WebhookNotifierOptions {
	/** Logger instance */
	logger: Logger;
	/** Base URL for Observatory (for review links) */
	observatoryUrl?: string;
	/** Timeout for webhook requests (ms) */
	timeoutMs?: number;
	/** Function to get webhook config for an org */
	getOrgWebhookConfig?: (orgId: string) => Promise<OrgWebhookConfig | null>;
}

// =============================================================================
// WebhookNotifier Service
// =============================================================================

/**
 * Service for sending webhook notifications.
 *
 * @example
 * ```typescript
 * const notifier = new WebhookNotifier({
 *   logger,
 *   observatoryUrl: "https://observatory.engram.rawcontext.com",
 *   getOrgWebhookConfig: async (orgId) => {
 *     // Fetch from database or config
 *     return { url: "https://hooks.example.com/conflicts", enabled: true };
 *   },
 * });
 *
 * await notifier.notifyConflicts({
 *   project: "engram",
 *   orgId: "org_123",
 *   scanId: "scan_456",
 *   conflicts: [...]
 * });
 * ```
 */
export class WebhookNotifier {
	private logger: Logger;
	private observatoryUrl: string;
	private timeoutMs: number;
	private getOrgWebhookConfig: (orgId: string) => Promise<OrgWebhookConfig | null>;

	constructor(options: WebhookNotifierOptions) {
		this.logger = options.logger.child({ component: "webhook-notifier" });
		this.observatoryUrl =
			options.observatoryUrl || process.env.OBSERVATORY_URL || "http://localhost:6178";
		this.timeoutMs = options.timeoutMs || 10_000;
		this.getOrgWebhookConfig =
			options.getOrgWebhookConfig || this.defaultGetWebhookConfig.bind(this);
	}

	/**
	 * Default implementation to get webhook config from environment.
	 * Falls back to CONFLICT_WEBHOOK_URL if set.
	 */
	private async defaultGetWebhookConfig(_orgId: string): Promise<OrgWebhookConfig | null> {
		const webhookUrl = process.env.CONFLICT_WEBHOOK_URL;
		if (!webhookUrl) {
			return null;
		}

		return {
			url: webhookUrl,
			secret: process.env.CONFLICT_WEBHOOK_SECRET,
			enabled: true,
		};
	}

	/**
	 * Send conflict notification to the org's configured webhook.
	 *
	 * @param options - Notification options
	 * @returns True if notification was sent successfully, false otherwise
	 */
	async notifyConflicts(options: {
		project: string;
		orgId: string;
		scanId: string;
		conflicts: ConflictSummary[];
	}): Promise<boolean> {
		const { project, orgId, scanId, conflicts } = options;

		// Get webhook config for this org
		const config = await this.getOrgWebhookConfig(orgId);

		if (!config || !config.enabled) {
			this.logger.debug({ orgId }, "No webhook configured for org, skipping notification");
			return false;
		}

		// Build payload
		const payload: ConflictWebhookPayload = {
			event: "conflicts_detected",
			timestamp: new Date().toISOString(),
			project,
			orgId,
			scanId,
			count: conflicts.length,
			conflicts,
			reviewUrl: `${this.observatoryUrl}/conflicts?scanId=${scanId}`,
		};

		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				"User-Agent": "Engram-Worker/1.0",
				"X-Engram-Event": "conflicts_detected",
				"X-Engram-Scan-Id": scanId,
			};

			// Add HMAC signature if secret is configured
			if (config.secret) {
				const signature = await this.signPayload(JSON.stringify(payload), config.secret);
				headers["X-Engram-Signature"] = signature;
			}

			const response = await fetch(config.url, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(this.timeoutMs),
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => "Unknown error");
				this.logger.warn(
					{
						status: response.status,
						error: errorText,
						orgId,
						scanId,
					},
					"Webhook request failed",
				);
				return false;
			}

			this.logger.info(
				{
					orgId,
					scanId,
					conflictCount: conflicts.length,
					webhookUrl: config.url.replace(/\/\/[^@]+@/, "//***@"), // Mask credentials
				},
				"Conflict notification sent successfully",
			);

			return true;
		} catch (error) {
			this.logger.error(
				{
					error,
					orgId,
					scanId,
				},
				"Failed to send webhook notification",
			);
			return false;
		}
	}

	/**
	 * Sign a payload using HMAC-SHA256.
	 *
	 * @param payload - JSON string payload
	 * @param secret - HMAC secret
	 * @returns Hex-encoded signature
	 */
	private async signPayload(payload: string, secret: string): Promise<string> {
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);

		const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));

		// Convert to hex
		return Array.from(new Uint8Array(signature))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}
}

/**
 * Create a WebhookNotifier instance.
 */
export function createWebhookNotifier(options: WebhookNotifierOptions): WebhookNotifier {
	return new WebhookNotifier(options);
}
