import { RawStreamEventSchema } from "@the-soul/events";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { validate } from "../../../lib/validate";

// Zod Schema for Documentation (re-exporting or referencing)
export const _IngestBody = RawStreamEventSchema;

/**
 * Ingest a raw event stream
 * @body IngestBody
 * @response 202:object:Event accepted
 * @response 400:object:Validation error
 */
export const POST = async (req: Request) => {
  // Cast the schema to z.ZodSchema<unknown> for the validate helper,
  // but rely on the inner inference for data usage.
  // validate() ensures runtime structure.
  return validate(RawStreamEventSchema as unknown as z.ZodSchema<unknown>)(req, async (data) => {
    const event = RawStreamEventSchema.parse(data);
    console.log("Ingesting event:", event.event_id);
    // TODO: Push to Redpanda via Ingestion Service or direct Kafka client
    return NextResponse.json({ status: "accepted", event_id: event.event_id }, { status: 202 });
  });
};
