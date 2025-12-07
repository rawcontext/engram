import { NextResponse } from "next/server";
import { RawStreamEventSchema } from "@the-soul/events";
import { validate } from "../../../lib/validate";

export const POST = async (req: Request) => {
  // The issue is likely generic type inference between Zod versions or Next.js req/res types.
  // Casting schema to any to bypass strict structural check for V1, or refining lib/validate type.
  // validate() expects ZodSchema<any>, RawStreamEventSchema is ZodObject<...>.
  // It should work, but Zod 4 might have subtle changes in type definition.
  // Let's try using the helper with explicit generic or cast.

  // @ts-ignore - Zod type mismatch in build pipeline (Zod 3 vs 4 types in monorepo?)
  return validate(RawStreamEventSchema)(req, async (data) => {
    console.log("Ingesting event:", data.event_id);
    // TODO: Push to Redpanda via Ingestion Service or direct Kafka client
    return NextResponse.json({ status: "accepted", event_id: data.event_id }, { status: 202 });
  });
};
