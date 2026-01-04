/**
 * Worker Services
 *
 * Shared services used by job consumers and algorithms.
 */

export {
	type ConflictSummary,
	type ConflictWebhookPayload,
	createWebhookNotifier,
	type OrgWebhookConfig,
	WebhookNotifier,
	type WebhookNotifierOptions,
} from "./webhook-notifier";
