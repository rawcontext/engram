import { NextResponse } from "next/server";
import { z } from "zod";

export const validate =
  (schema: z.ZodSchema<any>) =>
  async (req: Request, next: (data: any) => Promise<NextResponse>) => {
    try {
      const body = await req.json();
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      return next(parsed.data);
    } catch (e) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
  };
