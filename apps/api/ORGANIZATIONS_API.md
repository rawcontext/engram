# Organizations API

CRUD endpoints for managing organizations in the Engram API.

## Authentication

All endpoints require OAuth 2.1 authentication with appropriate scopes:
- `org:read` - Read organization data
- `org:write` - Create, update, and delete organizations

## Endpoints

### POST /v1/organizations

Create a new organization.

**Scopes Required**: `org:write`

**Request Body**:
```json
{
  "name": "My Organization",
  "slug": "my-org"  // Optional - auto-generated from name if omitted
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "01HQXYZ...",
      "slug": "my-org",
      "name": "My Organization",
      "createdAt": "2025-01-15T10:30:00Z",
      "updatedAt": "2025-01-15T10:30:00Z"
    }
  }
}
```

**Validation**:
- `name`: 1-100 characters
- `slug`: 1-32 characters, lowercase alphanumeric with optional hyphens
  - Must start and end with alphanumeric character
  - Pattern: `/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$|^[a-z0-9]{1,2}$/`

**Error Responses**:
- `400 VALIDATION_ERROR` - Invalid name or slug format
- `409 CONFLICT` - Slug already exists

---

### GET /v1/organizations

List all organizations the authenticated user has access to.

**Scopes Required**: `org:read`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "organizations": [
      {
        "id": "01HQXYZ...",
        "slug": "my-org",
        "name": "My Organization",
        "createdAt": "2025-01-15T10:30:00Z",
        "updatedAt": "2025-01-15T10:30:00Z"
      }
    ]
  }
}
```

---

### GET /v1/organizations/:id

Get a specific organization by ID.

**Scopes Required**: `org:read`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "01HQXYZ...",
      "slug": "my-org",
      "name": "My Organization",
      "createdAt": "2025-01-15T10:30:00Z",
      "updatedAt": "2025-01-15T10:30:00Z"
    }
  }
}
```

**Error Responses**:
- `403 FORBIDDEN` - User does not have access to this organization
- `404 NOT_FOUND` - Organization does not exist

---

### PUT /v1/organizations/:id

Update an organization's name or slug.

**Scopes Required**: `org:write`

**Request Body**:
```json
{
  "name": "Updated Organization Name",  // Optional
  "slug": "updated-slug"                 // Optional
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "organization": {
      "id": "01HQXYZ...",
      "slug": "updated-slug",
      "name": "Updated Organization Name",
      "createdAt": "2025-01-15T10:30:00Z",
      "updatedAt": "2025-01-15T12:00:00Z"
    }
  }
}
```

**Validation**:
- Same as POST endpoint
- At least one field must be provided

**Error Responses**:
- `400 VALIDATION_ERROR` - Invalid name or slug format
- `403 FORBIDDEN` - User does not have access to this organization
- `404 NOT_FOUND` - Organization does not exist
- `409 CONFLICT` - New slug already exists

---

### DELETE /v1/organizations/:id

Delete an organization.

**Scopes Required**: `org:write`

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

**Error Responses**:
- `403 FORBIDDEN` - User does not have access to this organization
- `404 NOT_FOUND` - Organization does not exist

---

## Access Control

Users can only access organizations they are members of. Access is determined by:
1. User's `org_id` field matches the organization ID

Admins with `admin:read` scope can access all organizations (cross-tenant queries).

## Slug Generation

If no slug is provided during creation, it is auto-generated from the organization name:
- Converts to lowercase
- Replaces non-alphanumeric characters with hyphens
- Removes leading/trailing hyphens
- Truncates to 32 characters

Example: `"My Cool Organization!"` → `"my-cool-organization"`

## Implementation

**Files**:
- `/apps/api/src/routes/organizations.ts` - HTTP endpoints
- `/apps/api/src/db/organizations.ts` - Repository for database operations
- `/apps/api/src/routes/organizations.test.ts` - Test suite

**Database**:
- Table: `organizations`
- Schema defined in: `/apps/api/src/db/init.sql`
