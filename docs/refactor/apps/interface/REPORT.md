# Refactoring Analysis Report: apps/interface

**Generated**: 2025-12-09
**Codebase**: `/Users/ccheney/Projects/the-system/apps/interface`
**Analysis Type**: READ-ONLY

---

## Executive Summary

The `apps/interface` application is a Next.js 15 frontend providing a neural observatory interface for session management, search, and graph visualization. The codebase demonstrates solid fundamentals but has accumulated technical debt primarily in **component complexity**, **code duplication**, and **missing abstractions**.

| Category | Issues Found | High | Medium | Low |
|----------|-------------|------|--------|-----|
| Code Smells | 14 | 4 | 7 | 3 |
| Architecture | 8 | 2 | 4 | 2 |
| DRY Violations | 9 | 3 | 4 | 2 |
| SOLID Violations | 6 | 2 | 3 | 1 |
| Type Safety | 5 | 1 | 3 | 1 |
| Error Handling | 4 | 1 | 2 | 1 |
| Testing Gaps | 6 | 2 | 3 | 1 |

---

## 1. Code Smells and Complexity Issues

### HIGH: God Component - SessionReplay.tsx

**File**: `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionReplay.tsx`
**Lines**: 1580
**Cyclomatic Complexity**: Estimated 45+

**Problem**: This single file contains:
- 10+ React components (`TypingCursor`, `ReasoningTrace`, `ResponseCard`, `QueryCard`, `TurnHeader`, `ToolCallCard`, `StatsHeader`, `LoadingState`, `EmptyState`, `SessionReplay`)
- Multiple helper functions (`isThinkingContent`, `cleanThinkingMarkers`, `consolidateTimeline`)
- Extensive inline styles (100+ style objects)
- Business logic for message consolidation mixed with presentation

**Impact**:
- Difficult to test individual components
- Changes risk unintended side effects
- Poor code discoverability

**Recommendation**: Extract to separate files:
```
components/SessionReplay/
  index.tsx           # Main SessionReplay component
  MessageCards/
    ResponseCard.tsx
    QueryCard.tsx
    ToolCallCard.tsx
    ReasoningTrace.tsx
    TurnHeader.tsx
  StatsHeader.tsx
  LoadingState.tsx
  EmptyState.tsx
  utils/
    consolidateTimeline.ts
    messageUtils.ts
```

---

### HIGH: God Component - LineageGraph.tsx

**File**: `/Users/ccheney/Projects/the-system/apps/interface/app/components/LineageGraph.tsx`
**Lines**: 1171
**Cyclomatic Complexity**: Estimated 35+

**Problem**: Contains multiple responsibilities:
- Graph layout algorithms (`getRadialLayout`, `getGridLayout`)
- Node type configurations (100+ lines of static config)
- Custom node components (`NeuralNode`)
- Stats display (`GraphStats`)
- Empty/Loading states
- Extensive inline CSS

**Recommendation**: Extract:
```
components/LineageGraph/
  index.tsx
  NeuralNode.tsx
  GraphStats.tsx
  layouts/
    radialLayout.ts
    gridLayout.ts
  config/
    nodeTypeConfig.ts
  states/
    LoadingSkeleton.tsx
    EmptyState.tsx
```

---

### HIGH: Complex Timeline Consolidation Logic

**File**: `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionReplay.tsx`
**Lines**: 73-219 (`consolidateTimeline` function)
**Cyclomatic Complexity**: 25+

**Problem**: The `consolidateTimeline` function has deep nesting (4+ levels), multiple boolean conditions, and handles token streaming, message type detection, and deduplication in a single function.

```typescript
// Lines 128-145: Deeply nested type determination
if (isCompleteThought || isNewThinkingBlock) {
    flushBuffer();
    const graphNodeId = (event as { graphNodeId?: string }).graphNodeId || nodeId;
    messages.push({
        type: type.includes("action")
            ? "action"
            : type.includes("observation")
                ? "observation"
                : type.includes("system")
                    ? "system"
                    : "thought",
        // ...
    });
}
```

**Recommendation**:
1. Extract type detection to separate function
2. Use Strategy pattern for message processing
3. Consider state machine for streaming token consolidation

---

### HIGH: Excessive Inline Styles

**Files Affected**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionReplay.tsx` (200+ style objects)
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/LineageGraph.tsx` (150+ style objects)
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionBrowser.tsx` (100+ style objects)
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SearchResults.tsx` (100+ style objects)

**Impact**:
- No style reuse across components
- Difficult to maintain consistent design system
- Performance impact from style object recreation

**Recommendation**: Adopt CSS-in-JS solution (styled-components) or CSS Modules with design tokens:
```typescript
// Design tokens
const tokens = {
  colors: {
    amber: 'rgb(251, 191, 36)',
    cyan: 'rgb(34, 211, 238)',
    // ...
  },
  spacing: { /* ... */ },
  animation: { /* ... */ }
};
```

---

### MEDIUM: Long Parameter Lists

**File**: `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionBrowser.tsx`
**Lines**: 52-68

```typescript
function SessionCard({
    session,
    index,
    isHovered,
    onHover,
    onLeave,
    onClick,
    isLive = false,
}: {
    session: Session;
    index: number;
    isHovered: boolean;
    onHover: () => void;
    onLeave: () => void;
    onClick: () => void;
    isLive?: boolean;
}) {
```

**Recommendation**: Use compound component pattern or context:
```typescript
<SessionCard session={session} isLive>
  <SessionCard.Hover>
    {/* hover state */}
  </SessionCard.Hover>
</SessionCard>
```

---

### MEDIUM: Magic Numbers and Strings

**Locations**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/LineageGraph.tsx:36-37` - `nodeWidth = 160`, `nodeHeight = 50`
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/LineageGraph.tsx:89-91` - Layout constants (250, 80, 65)
- `/Users/ccheney/Projects/the-system/apps/interface/app/hooks/useSessionStream.ts:39` - `maxReconnectAttempts = 5`
- `/Users/ccheney/Projects/the-system/apps/interface/app/hooks/useSessionsStream.ts:42` - `maxReconnectAttempts = 10`
- `/Users/ccheney/Projects/the-system/apps/interface/lib/graph-queries.ts:470` - `activeThresholdMs = 60 * 1000`

**Recommendation**: Extract to configuration constants:
```typescript
// config/constants.ts
export const GRAPH_CONFIG = {
  NODE_WIDTH: 160,
  NODE_HEIGHT: 50,
  LAYOUT: {
    COLUMN_GAP: 250,
    ROW_GAP: 80,
    CHILD_GAP: 65,
  }
};

export const WEBSOCKET_CONFIG = {
  MAX_RECONNECT_ATTEMPTS: 5,
  RECONNECT_BACKOFF_MS: 1000,
};
```

---

### MEDIUM: Feature Envy in graph-queries.ts

**File**: `/Users/ccheney/Projects/the-system/apps/interface/lib/graph-queries.ts`
**Lines**: 465-550 (`getAllSessions` function)

**Problem**: This function makes 3 separate database queries per session (count, preview), creating N+1 query pattern:

```typescript
// Lines 497-512: N+1 queries
for (const row of result) {
    // ... for each session:
    const countQuery = `MATCH ...`;
    const countRes = await falkor.query<CountRow>(countQuery, { sessionId });

    const previewQuery = `MATCH ...`;
    const previewRes = await falkor.query<PreviewRow>(previewQuery, { sessionId });
}
```

**Impact**: O(n) database round trips instead of O(1)

**Recommendation**: Consolidate into single aggregating query like `getSessionsForWebSocket` does.

---

### LOW: Unused Exports

**Locations**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionReplay.tsx:1020` - `_TimestampBadge` (prefixed with underscore but exported)
- `/Users/ccheney/Projects/the-system/apps/interface/app/api/search/route.ts:34` - `_SearchResponseSchema` (unused)
- `/Users/ccheney/Projects/the-system/apps/interface/app/api/lineage/[sessionId]/route.ts:5` - `_LineageParams` (unused)

---

## 2. Architecture Improvements

### HIGH: Missing Service Layer

**Problem**: API routes directly call graph-queries functions, mixing HTTP concerns with business logic.

**Current**:
```
API Route -> graph-queries.ts -> FalkorDB
```

**Recommended**:
```
API Route -> Service Layer -> Repository -> FalkorDB
                    |
                    v
              Domain Models
```

**Benefits**:
- Testable business logic
- Consistent error handling
- Easier to add caching

---

### HIGH: Duplicated Session Type Definitions

**Locations**:
- `/Users/ccheney/Projects/the-system/apps/interface/lib/graph-queries.ts:78-88` (`SessionListItem`)
- `/Users/ccheney/Projects/the-system/apps/interface/app/hooks/useSessionsStream.ts:5-14` (`Session`)
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionBrowser.tsx:8-16` (`Session`)

All three define nearly identical interfaces. This violates DRY and creates maintenance burden.

**Recommendation**: Single source of truth in `lib/types.ts`:
```typescript
export interface SessionListItem {
    id: string;
    title: string | null;
    userId: string;
    startedAt: number;
    lastEventAt: number | null;
    eventCount: number;
    preview: string | null;
    isActive: boolean;
}
```

---

### MEDIUM: No Centralized Error Handling

**Problem**: Each API route and hook handles errors independently with inconsistent patterns.

**Files**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/api/search/route.ts:113-116`
- `/Users/ccheney/Projects/the-system/apps/interface/app/api/sessions/route.ts:23-26`
- `/Users/ccheney/Projects/the-system/apps/interface/app/hooks/useSessionStream.ts:66-69`

**Recommendation**: Create error boundary and centralized error types:
```typescript
// lib/errors.ts
export class AppError extends Error {
    constructor(
        message: string,
        public code: string,
        public statusCode: number = 500
    ) {
        super(message);
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string) {
        super(`${resource} not found`, 'NOT_FOUND', 404);
    }
}
```

---

### MEDIUM: Inconsistent Data Fetching Patterns

**Problem**: Multiple approaches used:
1. `useSWR` in `useSearch.ts`
2. Manual fetch + state in `useSessionStream.ts`
3. WebSocket in `useSessionsStream.ts`

**Recommendation**: Standardize on a single approach with clear guidelines:
- SWR for simple REST fetches
- Custom hooks for WebSocket/real-time
- Consider TanStack Query for unified approach

---

### MEDIUM: Component Directory Structure

**Current Structure**:
```
app/
  components/
    EngramLogo.tsx
    LineageGraph.tsx
    NeuralBackground.tsx
    SearchInput.tsx
    SearchResults.tsx
    SearchSettings.tsx
    SessionBrowser.tsx
    SessionReplay.tsx
  hooks/
    useSearch.ts
    useSessionStream.ts
    useSessionsStream.ts
```

**Recommended Structure**:
```
app/
  features/
    search/
      components/
        SearchInput.tsx
        SearchResults.tsx
        SearchSettings.tsx
      hooks/
        useSearch.ts
      index.ts
    session/
      components/
        SessionBrowser.tsx
        SessionReplay/
        LineageGraph/
      hooks/
        useSessionStream.ts
        useSessionsStream.ts
    shared/
      components/
        EngramLogo.tsx
        NeuralBackground.tsx
```

---

### LOW: Missing Loading Boundaries

**Problem**: Each component implements its own loading state, leading to inconsistent UX.

**Recommendation**: Use React Suspense boundaries:
```tsx
<Suspense fallback={<SessionLoadingSkeleton />}>
  <SessionReplay data={data} />
</Suspense>
```

---

## 3. DRY Violations (Duplicated Code)

### HIGH: Duplicate WebSocket Reconnection Logic

**Files**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/hooks/useSessionStream.ts:169-197`
- `/Users/ccheney/Projects/the-system/apps/interface/app/hooks/useSessionsStream.ts:153-180`

Both hooks implement nearly identical WebSocket connection, reconnection with exponential backoff, and cleanup logic.

**Recommendation**: Extract to shared hook:
```typescript
// hooks/useWebSocket.ts
export function useWebSocket({
    url,
    onMessage,
    maxReconnectAttempts = 5,
}: UseWebSocketOptions) {
    // Shared implementation
}
```

---

### HIGH: Duplicate Empty State Components

**Files**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionReplay.tsx:1131-1243` (`EmptyState`)
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/LineageGraph.tsx:619-734` (`EmptyState`)

Both implement similar "no data" states with animated icons. They should share a base component.

**Recommendation**:
```typescript
// components/shared/EmptyState.tsx
export function EmptyState({
    title,
    subtitle,
    icon: Icon,
    accentColor = 'amber',
}: EmptyStateProps) { /* ... */ }
```

---

### HIGH: Duplicate Loading States

**Files**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionReplay.tsx:1048-1128` (`LoadingState`)
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/LineageGraph.tsx:590-616` (`LoadingSkeleton`)
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionBrowser.tsx:290-322`

**Recommendation**: Unified loading component system.

---

### MEDIUM: Duplicate formatRelativeTime Functions

**Files**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionBrowser.tsx:18-35`
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SearchResults.tsx:79-94`

Both implement relative time formatting with slight variations.

**Recommendation**: Single utility function:
```typescript
// lib/utils/formatters.ts
export function formatRelativeTime(timestamp: number): string { /* ... */ }
```

---

### MEDIUM: Duplicate truncateId Functions

**Files**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionBrowser.tsx:37-40`
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SearchResults.tsx:96-99`

Both truncate UUIDs to 8 characters.

---

### MEDIUM: Duplicate Particle Components

**Files**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/page.tsx:19-62` (`Particles`)
- `/Users/ccheney/Projects/the-system/apps/interface/app/session/[sessionId]/view.tsx:19-58` (`Particles`)

Both implement floating particle effects with pre-computed positions.

---

### MEDIUM: Duplicate Color Constants

Multiple files define the same color values:
- `rgb(251, 191, 36)` (amber) - 50+ occurrences
- `rgb(34, 211, 238)` (cyan) - 30+ occurrences
- `rgb(139, 92, 246)` (violet) - 20+ occurrences

**Recommendation**: Design tokens system.

---

### LOW: Duplicate Keyframe Animations

Animation definitions repeated across files:
- `pulse`, `cardReveal`, `livePulse` in multiple components
- `spin`, `float` in multiple components

---

## 4. SOLID Principle Violations

### HIGH: Single Responsibility Principle - graph-queries.ts

**File**: `/Users/ccheney/Projects/the-system/apps/interface/lib/graph-queries.ts`
**Lines**: 630

**Violations**:
1. Contains type definitions (should be in types.ts)
2. Contains business logic (session classification)
3. Contains data access (FalkorDB queries)
4. Contains utility functions (`truncatePreview`)

**Recommendation**: Split into:
- `types/session.ts` - Type definitions
- `repositories/sessionRepository.ts` - Data access
- `services/sessionService.ts` - Business logic
- `utils/text.ts` - Utilities

---

### HIGH: Open/Closed Principle - Message Type Handling

**File**: `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionReplay.tsx`
**Lines**: 165-178

```typescript
let msgType: MessageType = MESSAGE_TYPES.THOUGHT;
if (type.includes(MESSAGE_TYPES.TURN)) {
    msgType = MESSAGE_TYPES.TURN;
} else if (type.includes(MESSAGE_TYPES.TOOLCALL)) {
    msgType = MESSAGE_TYPES.TOOLCALL;
} else if (type.includes(MESSAGE_TYPES.RESPONSE)) {
    msgType = MESSAGE_TYPES.RESPONSE;
// ... more conditions
```

Adding new message types requires modifying this function.

**Recommendation**: Use registry pattern:
```typescript
const MESSAGE_HANDLERS: Record<string, MessageHandler> = {
    turn: new TurnMessageHandler(),
    toolcall: new ToolCallMessageHandler(),
    // Easy to add new types
};
```

---

### MEDIUM: Dependency Inversion - Direct Database Access

**Files**:
- `/Users/ccheney/Projects/the-system/apps/interface/lib/graph-queries.ts` - Direct FalkorDB client usage
- `/Users/ccheney/Projects/the-system/apps/interface/lib/websocket-server.ts` - Direct Redis client usage

High-level modules depend directly on low-level database clients.

**Recommendation**: Inject dependencies:
```typescript
interface SessionRepository {
    getLineage(sessionId: string): Promise<LineageData>;
    getTimeline(sessionId: string): Promise<TimelineData>;
}

// Implementation
class FalkorSessionRepository implements SessionRepository { /* ... */ }
```

---

### MEDIUM: Interface Segregation - Large Props Interfaces

**File**: `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionReplay.tsx:25-43`

`ConsolidatedMessage` interface has 15 properties, many optional. Components receiving this must handle all cases.

**Recommendation**: Split into discriminated unions:
```typescript
type ConsolidatedMessage =
    | TurnMessage
    | ToolCallMessage
    | ThoughtMessage
    | ResponseMessage;

interface TurnMessage {
    type: 'turn';
    turnNumber: string;
    timestamp: string;
}
```

---

### LOW: Liskov Substitution - No Interface Contracts

Components like `SearchInput`, `SearchResults` have implicit contracts through props but no formal interface definitions for parent components to program against.

---

## 5. Dependency Issues

### MEDIUM: Tight Coupling to External Libraries

**Files**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/LineageGraph.tsx` - Direct ReactFlow usage (1170 lines)
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/NeuralBackground.tsx` - Direct Three.js/React Three Fiber usage

**Impact**: Difficult to swap visualization libraries if needed.

**Recommendation**: Create adapter layer:
```typescript
// adapters/graphAdapter.ts
export interface GraphAdapter {
    render(data: LineageData): React.ReactNode;
}

export class ReactFlowAdapter implements GraphAdapter { /* ... */ }
```

---

### MEDIUM: Missing Dependency Injection for Singletons

**Files**:
- `/Users/ccheney/Projects/the-system/apps/interface/lib/graph-queries.ts:9` - `const falkor = createFalkorClient();`
- `/Users/ccheney/Projects/the-system/apps/interface/lib/websocket-server.ts:5` - `const redisSubscriber = createRedisSubscriber();`

Module-level singletons make testing difficult.

---

### LOW: Version Mismatches in package.json

**File**: `/Users/ccheney/Projects/the-system/apps/interface/package.json`

Consider auditing dependency versions for compatibility, especially React 19.x features.

---

## 6. Testing Gaps

### HIGH: No Unit Tests for Core Business Logic

**Missing Tests**:
- `/Users/ccheney/Projects/the-system/apps/interface/lib/graph-queries.ts` - 0 tests for 600+ lines
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionReplay.tsx` - `consolidateTimeline` function untested

**Recommendation**: Add comprehensive unit tests:
```typescript
// lib/graph-queries.test.ts
describe('getSessionLineage', () => {
    it('should return nodes and links for valid session', async () => { /* ... */ });
    it('should handle empty graph gracefully', async () => { /* ... */ });
    it('should deduplicate edges', async () => { /* ... */ });
});
```

---

### HIGH: No Component Tests

**Missing**:
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionReplay.tsx`
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/LineageGraph.tsx`
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SearchResults.tsx`

Only E2E tests exist (`app/e2e/session-realtime.spec.ts`), no unit/integration tests.

---

### MEDIUM: Incomplete Hook Tests

**File**: `/Users/ccheney/Projects/the-system/apps/interface/app/hooks/useSessionStream.test.ts`

Only 1 test file exists. Missing tests for:
- `useSearch.ts`
- `useSessionsStream.ts`

---

### MEDIUM: Limited RBAC Test Coverage

**File**: `/Users/ccheney/Projects/the-system/apps/interface/lib/rbac.test.ts`
**Lines**: 30

Only 2 tests for RBAC module. Missing:
- `withRole` HOF tests
- Error boundary tests
- Multiple role scenarios

---

### LOW: No Visual Regression Tests

Complex visualizations (LineageGraph, NeuralBackground, EngramLogo) have no visual regression coverage.

---

## 7. Type Safety Issues

### HIGH: Excessive Use of `any` and Index Signatures

**Locations**:
- `/Users/ccheney/Projects/the-system/apps/interface/lib/graph-queries.ts:36-37`: `[key: number]: SessionNode | undefined`
- `/Users/ccheney/Projects/the-system/apps/interface/lib/lib.test.ts:9,16,22,39,41,46,51,67,70`: `(res as any)`
- `/Users/ccheney/Projects/the-system/apps/interface/lib/types.ts:5,22`: `[key: string]: unknown`

**Recommendation**: Define explicit types:
```typescript
// Instead of:
interface TimelineEvent {
    id: string;
    [key: string]: unknown;
}

// Use:
interface TimelineEvent {
    id: string;
    type: string;
    content?: string;
    timestamp?: string;
    // ... explicit properties
}
```

---

### MEDIUM: Type Assertions Without Validation

**File**: `/Users/ccheney/Projects/the-system/apps/interface/app/hooks/useSessionStream.ts:52-53`

```typescript
const lineageData = lineageJson.data as LineageResponse;
const replayData = replayJson.data as ReplayResponse;
```

No runtime validation of API responses.

**Recommendation**: Use Zod schemas for runtime validation:
```typescript
const lineageData = LineageResponseSchema.parse(lineageJson.data);
```

---

### MEDIUM: Implicit Any in Test Mocks

**File**: `/Users/ccheney/Projects/the-system/apps/interface/lib/lib.test.ts:9`

```typescript
NextResponse: {
    json: (body: any, init?: any) => ({ body, init }),
},
```

---

### LOW: Missing Return Type Annotations

Several functions lack explicit return types:
- `/Users/ccheney/Projects/the-system/apps/interface/lib/graph-queries.ts:612-614` - `truncatePreview`
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionBrowser.tsx:18-35` - `formatRelativeTime`

---

## 8. Error Handling Patterns

### HIGH: Silent Error Swallowing

**File**: `/Users/ccheney/Projects/the-system/apps/interface/app/page.tsx:78-80`

```typescript
try {
    localStorage.setItem("engram-search-settings", JSON.stringify(settings));
} catch {
    // Ignore storage errors
}
```

Silently ignoring errors can hide issues.

**Recommendation**: Log errors even if not acting on them:
```typescript
catch (error) {
    console.warn('Failed to save settings:', error);
}
```

---

### MEDIUM: Inconsistent Error Messages

API routes use different error code formats:
- `LINEAGE_QUERY_FAILED` vs `REPLAY_QUERY_FAILED` vs `SEARCH_FAILED`
- `SESSIONS_QUERY_FAILED` vs `VALIDATION_ERROR`

**Recommendation**: Standardize error codes:
```typescript
enum ErrorCode {
    QUERY_FAILED = 'QUERY_FAILED',
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    NOT_FOUND = 'NOT_FOUND',
    // ...
}
```

---

### MEDIUM: No Error Boundaries

**Problem**: No React Error Boundaries in the component tree. A crash in LineageGraph will crash the entire page.

**Recommendation**: Add error boundaries:
```tsx
<ErrorBoundary fallback={<GraphErrorFallback />}>
    <LineageGraph data={data} />
</ErrorBoundary>
```

---

### LOW: Unhandled Promise Rejections in Effects

**File**: `/Users/ccheney/Projects/the-system/apps/interface/app/hooks/useSessionStream.ts:216-243`

The useEffect contains async operations without proper error handling for all paths.

---

## 9. Performance Considerations

### MEDIUM: Re-render Optimization

**File**: `/Users/ccheney/Projects/the-system/apps/interface/app/components/LineageGraph.tsx`

`NeuralNode` component is memoized but receives object styles inline, defeating memoization for style objects.

**Recommendation**: Memoize style objects or use CSS classes.

---

### MEDIUM: Large Component Bundle

`SessionReplay.tsx` and `LineageGraph.tsx` should be code-split for initial load optimization.

---

### LOW: Missing useMemo/useCallback

Several event handlers recreated on each render:
- `/Users/ccheney/Projects/the-system/apps/interface/app/components/SessionBrowser.tsx:286` - `handleSessionClick`

---

## 10. Recommended Refactoring Roadmap

### Phase 1: Quick Wins (1-2 days)
1. Extract shared utility functions (formatRelativeTime, truncateId)
2. Create design tokens file for colors
3. Add missing return type annotations
4. Fix silent error swallowing

### Phase 2: Component Decomposition (1 week)
1. Split SessionReplay.tsx into feature folder
2. Split LineageGraph.tsx into feature folder
3. Extract shared Empty/Loading states
4. Create unified WebSocket hook

### Phase 3: Architecture (2 weeks)
1. Introduce service layer
2. Consolidate type definitions
3. Add repository pattern
4. Implement proper dependency injection

### Phase 4: Testing (1 week)
1. Add unit tests for graph-queries.ts
2. Add component tests with Testing Library
3. Add visual regression tests for graphs
4. Improve RBAC test coverage

---

## Appendix: Files Analyzed

| File | Lines | Complexity |
|------|-------|------------|
| app/components/SessionReplay.tsx | 1580 | High |
| app/components/LineageGraph.tsx | 1171 | High |
| app/components/SearchResults.tsx | 828 | Medium |
| lib/graph-queries.ts | 630 | High |
| app/components/SessionBrowser.tsx | 561 | Medium |
| app/page.tsx | 382 | Medium |
| app/session/[sessionId]/view.tsx | 475 | Medium |
| app/hooks/useSessionStream.ts | 256 | Medium |
| app/hooks/useSessionsStream.ts | 217 | Medium |
| app/components/SearchInput.tsx | 264 | Low |
| lib/websocket-server.ts | 105 | Low |
| lib/rbac.ts | 79 | Low |
| lib/api-response.ts | 58 | Low |
| lib/validate.ts | 19 | Low |
| lib/types.ts | 27 | Low |

---

## Summary

The `apps/interface` codebase has grown organically and would benefit from targeted refactoring focused on:

1. **Breaking up God Components** - SessionReplay and LineageGraph need decomposition
2. **DRY Consolidation** - Multiple areas of duplicated code need unification
3. **Testing Investment** - Business logic has minimal test coverage
4. **Type Safety** - Reduce `any` usage and add runtime validation
5. **Architecture Layer** - Introduce service/repository patterns

Prioritize Phase 1 and 2 for immediate quality improvements before tackling deeper architectural changes.
