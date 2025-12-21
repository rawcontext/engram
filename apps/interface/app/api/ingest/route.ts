import { RawStreamEventSchema } from "@engram/events";
import { createKafkaClient } from "@engram/storage/kafka";
import { apiError, apiSuccess } from "@lib/api-response";
import { UserRole, withRole } from "@lib/rbac";
import { withTelemetry } from "@lib/telemetry";
import { validate } from "@lib/validate";

// Initialize Kafka
const kafka = createKafkaClient("interface-service");

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
				await kafka.sendEvent("raw_events", event.event_id, event);
				return apiSuccess({ status: "accepted", event_id: event.event_id }, 202);
			} catch (e: unknown) {
				console.error("Failed to publish to Redpanda", e);
				const message = e instanceof Error ? e.message : String(e);
				return apiError(`Ingestion failed: ${message}`, "KAFKA_ERROR", 500);
			}
		});
	}),
);
