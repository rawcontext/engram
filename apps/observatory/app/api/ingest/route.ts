import { RawStreamEventSchema } from "@engram/events";
import { createNatsClient } from "@engram/storage";
import { apiError, apiSuccess } from "@lib/api-response";
import { UserRole, withRole } from "@lib/rbac";
import { withTelemetry } from "@lib/telemetry";
import { validate } from "@lib/validate";

// Initialize NATS client
const nats = createNatsClient("observatory");

// Zod Schema for Documentation (re-exporting or referencing)
export const _IngestBody = RawStreamEventSchema;

/**
 * Ingest a raw event stream
 * @body IngestBody
 * @response 202:object:Event accepted
 * @response 400:object:Validation error
 * @response 401:object:Unauthorized
 * @response 403:object:Forbidden
 */
export const POST = withTelemetry(
	withRole(UserRole.SYSTEM)(async (req: Request) => {
		return validate(RawStreamEventSchema)(req, async (event) => {
			console.log("Ingesting event:", event.event_id);

			try {
				await nats.sendEvent("raw_events", event.event_id, event);
				return apiSuccess({ status: "accepted", event_id: event.event_id }, 202);
			} catch (e: unknown) {
				console.error("Failed to publish to NATS", e);
				const message = e instanceof Error ? e.message : String(e);
				return apiError(`Ingestion failed: ${message}`, "NATS_ERROR", 500);
			}
		});
	}),
);
