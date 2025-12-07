# Bead: Create API Request Validator

## Context
Ensure all inputs match Zod schemas.

## Goal
Middleware/HOF for validation.

## Logic
```typescript
export const validate = (schema) => async (req, next) => {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json(error, { status: 400 });
  return next(req, parsed.data);
}
```

## Acceptance Criteria
-   [ ] `withValidation` wrapper implemented.
