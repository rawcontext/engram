import { SearchRetriever } from "@the-soul/search-core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validate } from "../../../lib/validate";

// Initialize retriever (singleton behavior handled internally or by module caching)
const retriever = new SearchRetriever(process.env.QDRANT_URL || "http://localhost:6333");

const SearchRequestSchema = z.object({
  query: z.string(),
  limit: z.number().optional().default(10),
  filters: z
    .object({
      session_id: z.string().optional(),
      type: z.enum(["thought", "code", "doc"]).optional(),
    })
    .optional(),
});

export const _SearchResponseSchema = z.object({
  results: z.array(
    z.object({
      document: z.string(),
      score: z.number(),
      originalIndex: z.number(),
    }),
  ),
});

/**
 * Search the knowledge graph
 * @body SearchRequestSchema
 * @response SearchResponseSchema
 */
export const POST = async (req: Request) => {
  return validate(SearchRequestSchema as unknown as z.ZodSchema<unknown>)(req, async (data) => {
    const { query, limit, filters } = data as z.infer<typeof SearchRequestSchema>;

    try {
      const results = await retriever.search({
        text: query,
        limit,
        filters,
        strategy: "hybrid", // Default to hybrid
      });

      return NextResponse.json({ results });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
};
