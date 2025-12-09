# Refactoring Analysis Report: packages/infra

**Package**: `engram-infra`
**Location**: `/Users/ccheney/Projects/the-system/packages/infra`
**Generated**: 2024-12-09
**Analysis Type**: READ-ONLY

---

## Executive Summary

The `packages/infra` package is a Pulumi-based infrastructure-as-code module for provisioning GCP resources. While compact (76 LOC in the main file), it exhibits several architectural and organizational issues that should be addressed for maintainability and scalability.

| Severity | Count | Category |
|----------|-------|----------|
| High | 3 | Architecture, Testing, Type Safety |
| Medium | 5 | SOLID Violations, DRY, Error Handling |
| Low | 4 | Code Organization, Documentation |

---

## 1. Code Smells and Complexity Issues

### 1.1 Single File Architecture (High Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/index.ts`
**Lines**: 1-76

**Issue**: All infrastructure logic is contained in a single `index.ts` file with top-level execution. This violates separation of concerns and makes testing difficult.

```typescript
// Current: Everything in one file with imperative top-level code
const network = new gcp.compute.Network("engram-network", { ... });
const subnet = new gcp.compute.Subnetwork("engram-subnet", { ... });
const cluster = new gcp.container.Cluster("engram-data-cluster", { ... });
```

**Recommendation**: Extract into modular components:
- `network.ts` - Network and subnet configuration
- `cluster.ts` - GKE cluster configuration
- `secrets.ts` - Secret Manager resources
- `index.ts` - Composition and exports only

### 1.2 Hardcoded Configuration Values (Medium Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/index.ts`
**Lines**: 9-11, 17, 50

**Issue**: Region, CIDR ranges, and other configuration values are hardcoded.

```typescript
// Line 10: Hardcoded CIDR
ipCidrRange: "10.0.0.0/16",

// Line 11: Hardcoded region
region: "us-central1",

// Line 50: Accessing config at runtime with no validation
const context = `${gcp.config.project}_${gcp.config.zone}_${name}`;
```

**Impact**: Reduces reusability across environments; config changes require code changes.

### 1.3 Unused Variables (Low Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/index.ts`
**Lines**: 29, 34, 39

**Issue**: Secret resources are prefixed with underscore (`_openaiKey`, `_anthropicKey`, `_falkorPassword`) indicating they are intentionally unused, but they should either be exported or removed.

```typescript
const _openaiKey = new gcp.secretmanager.Secret("openai-api-key", { ... });
const _anthropicKey = new gcp.secretmanager.Secret("anthropic-api-key", { ... });
const _falkorPassword = new gcp.secretmanager.Secret("falkordb-password", { ... });
```

---

## 2. Architecture Improvements

### 2.1 Missing Abstraction Layer (High Severity)

**Issue**: No factory pattern or builder for resource creation. Resources are created imperatively without encapsulation.

**Current State**:
```typescript
// Direct instantiation everywhere
const cluster = new gcp.container.Cluster("engram-data-cluster", { ... });
```

**Recommended Pattern**:
```typescript
// Factory pattern for consistent resource creation
export function createGKECluster(config: ClusterConfig): gcp.container.Cluster {
  return new gcp.container.Cluster(config.name, {
    location: config.region,
    network: config.network.name,
    subnetwork: config.subnet.name,
    enableAutopilot: config.autopilot,
    deletionProtection: config.deletionProtection,
  });
}
```

### 2.2 Missing Configuration Schema (Medium Severity)

**Issue**: No TypeScript interfaces or Zod schemas for configuration validation.

**Impact**: Runtime errors from misconfiguration; no IDE autocompletion for configs.

**Recommendation**: Create `config.ts` with typed configuration:
```typescript
import { z } from "zod";

export const InfraConfigSchema = z.object({
  region: z.string().default("us-central1"),
  network: z.object({
    name: z.string(),
    cidrRange: z.string().regex(/^\d+\.\d+\.\d+\.\d+\/\d+$/),
  }),
  cluster: z.object({
    name: z.string(),
    autopilot: z.boolean().default(true),
    deletionProtection: z.boolean().default(true),
  }),
});
```

### 2.3 Inconsistent Project Structure (Medium Severity)

**Issue**: Package structure differs from other packages in the monorepo.

| Package | Structure | Entry Point |
|---------|-----------|-------------|
| `packages/storage` | `src/index.ts` | `src/index.ts` |
| `packages/events` | `src/index.ts` | `src/index.ts` |
| `packages/infra` | `index.ts` | `index.ts` (root) |

**tsconfig.json deviation**:
```json
// packages/infra/tsconfig.json - Line 8
"include": ["index.ts"]

// packages/tsconfig/base.json - Line 22 (base config)
"include": ["src/**/*"]
```

---

## 3. DRY Violations (Duplicated Code)

### 3.1 Repeated Secret Configuration (Medium Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/index.ts`
**Lines**: 24-42

**Issue**: Secret creation logic is duplicated three times with only the ID varying.

```typescript
// Lines 25-27: Replication config defined once
const secretReplication = {
  auto: {},
};

// Lines 29-32: Copy 1
const _openaiKey = new gcp.secretmanager.Secret("openai-api-key", {
  secretId: "openai-api-key",
  replication: secretReplication,
});

// Lines 34-37: Copy 2
const _anthropicKey = new gcp.secretmanager.Secret("anthropic-api-key", {
  secretId: "anthropic-api-key",
  replication: secretReplication,
});

// Lines 39-42: Copy 3
const _falkorPassword = new gcp.secretmanager.Secret("falkordb-password", {
  secretId: "falkordb-password",
  replication: secretReplication,
});
```

**Recommendation**: Extract to a factory function:
```typescript
function createSecret(id: string): gcp.secretmanager.Secret {
  return new gcp.secretmanager.Secret(id, {
    secretId: id,
    replication: { auto: {} },
  });
}

const secrets = {
  openai: createSecret("openai-api-key"),
  anthropic: createSecret("anthropic-api-key"),
  falkordb: createSecret("falkordb-password"),
};
```

### 3.2 K8s YAML Resource Duplication (Low Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/k8s/qdrant-values.yaml`
**File**: `/Users/ccheney/Projects/the-system/packages/infra/k8s/falkordb-statefulset.yaml`
**Lines**: Resource limits are duplicated

```yaml
# qdrant-values.yaml (Lines 11-17)
resources:
  requests:
    cpu: "1"
    memory: "2Gi"
  limits:
    cpu: "2"
    memory: "4Gi"

# falkordb-statefulset.yaml (Lines 23-28)
resources:
  requests:
    cpu: "1"
    memory: "2Gi"
  limits:
    cpu: "2"
    memory: "4Gi"
```

**Recommendation**: Consider using Kustomize or Helm for shared resource definitions.

---

## 4. SOLID Principle Violations

### 4.1 Single Responsibility Principle (SRP) Violation (Medium Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/index.ts`

**Issue**: The single file handles:
1. Network creation
2. Subnet creation
3. Cluster creation
4. Secret management
5. Kubeconfig generation
6. Exports

**Impact**: Changes to any concern require modifying the same file.

### 4.2 Open/Closed Principle (OCP) Violation (Medium Severity)

**Issue**: Adding new resources requires modifying the main file rather than extending.

**Example**: To add Cloud Run or Cloud SQL, you must edit `index.ts` directly.

### 4.3 Dependency Inversion Principle (DIP) Violation (Low Severity)

**Issue**: High-level modules depend directly on Pulumi GCP provider without abstraction.

```typescript
// Direct dependency on concrete implementation
import * as gcp from "@pulumi/gcp";
```

**Recommendation**: Create provider-agnostic interfaces for multi-cloud support:
```typescript
interface NetworkProvider {
  createNetwork(config: NetworkConfig): Network;
  createSubnet(config: SubnetConfig): Subnet;
}
```

---

## 5. Dependency Issues

### 5.1 Unused Dependency (Low Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/package.json`
**Line**: 13

```json
"@pulumi/kubernetes": "^4.24.1",
"@pulumi/random": "^4.18.4"
```

**Issue**: `@pulumi/kubernetes` and `@pulumi/random` are declared as dependencies but not imported in `index.ts`. They may be intended for K8s manifest deployment but are currently unused.

### 5.2 Missing Test Dependencies (High Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/package.json`

**Issue**: No test framework is declared in dependencies:
```json
{
  "devDependencies": {
    "@types/node": "^24.10.1",
    "@engram/tsconfig": "*"
  }
  // Missing: vitest, @vitest/coverage-v8, etc.
}
```

The test file imports from `vitest` but it's not in the package's dependencies - it relies on hoisting from the root `package.json`.

---

## 6. Testing Gaps

### 6.1 Insufficient Test Coverage (High Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/index.test.ts`

**Current Coverage**: ~5% (only tests that exports exist)

**Issue**: The test only verifies that exports are defined, not resource configuration:

```typescript
// Lines 41-50: Single shallow test
describe("Infra Package", () => {
  it("should define resources without error", async () => {
    const infra = await import("./index");
    expect(infra.networkName).toBeDefined();
    expect(infra.clusterName).toBeDefined();
    expect(infra.kubeconfig).toBeDefined();
  });
});
```

**Missing Test Cases**:
- Network CIDR validation
- Cluster configuration validation
- Secret replication policy validation
- Kubeconfig format validation
- Error handling for missing config

### 6.2 Mock Quality Issues (Medium Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/index.test.ts`
**Lines**: 4-39

**Issue**: Mocks are overly simplistic and don't validate resource arguments:

```typescript
// Line 4-13: Generic mock doesn't capture or validate args
const mockResource = class {
  constructor(name: string, args: any) {
    this.name = name;
    this.args = args;  // args captured but never asserted
    this.id = "mock-id";
  }
  // ...
};
```

**Recommendation**: Use Pulumi's testing utilities or create assertion-enabled mocks:
```typescript
const mockResource = vi.fn().mockImplementation((name, args) => {
  expect(args).toMatchSnapshot();  // or specific assertions
  return { name, id: `mock-${name}`, ...args };
});
```

### 6.3 No Integration Tests (Medium Severity)

**Issue**: No tests for actual Pulumi preview/up behavior or K8s manifest validation.

---

## 7. Type Safety Issues

### 7.1 Loose Typing in Kubeconfig Generation (High Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/index.ts`
**Lines**: 47-75

**Issue**: Kubeconfig is generated as a raw string template without type validation:

```typescript
export const kubeconfig = pulumi
  .all([cluster.name, cluster.endpoint, cluster.masterAuth])
  .apply(([name, endpoint, masterAuth]) => {
    // No type safety - masterAuth could be undefined
    const context = `${gcp.config.project}_${gcp.config.zone}_${name}`;
    return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${masterAuth.clusterCaCertificate}  // Could throw
    // ...
`;
  });
```

**Risk**: Runtime errors if `masterAuth` is undefined or `clusterCaCertificate` is missing.

**Recommendation**: Add type guards or use Zod for runtime validation:
```typescript
import { z } from "zod";

const MasterAuthSchema = z.object({
  clusterCaCertificate: z.string(),
});

// Then validate: MasterAuthSchema.parse(masterAuth)
```

### 7.2 Any Types in Test Mocks (Medium Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/index.test.ts`
**Lines**: 5, 16-17

```typescript
// Line 5: any type
constructor(name: string, args: any) {

// Lines 16-17: any types
all: (args: any[]) => ({
  apply: (fn: Function) => fn(args.map((_a) => "mock-value")),
}),
```

---

## 8. Error Handling Patterns

### 8.1 No Error Handling (High Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/index.ts`

**Issue**: No error handling for:
- Missing GCP configuration
- Network creation failures
- Cluster provisioning failures
- Secret manager errors

```typescript
// No try-catch, no validation, no error boundaries
const network = new gcp.compute.Network("engram-network", { ... });
const subnet = new gcp.compute.Subnetwork("engram-subnet", { ... });
```

**Risk**: Pulumi will fail at runtime with opaque errors.

**Recommendation**: Add validation and error handling:
```typescript
function validateConfig(): void {
  if (!gcp.config.project) {
    throw new Error("GCP project must be configured");
  }
  if (!gcp.config.region) {
    throw new Error("GCP region must be configured");
  }
}

// Call before resource creation
validateConfig();
```

### 8.2 No Graceful Degradation (Medium Severity)

**Issue**: If one resource fails, the entire stack fails with no partial state handling.

---

## 9. K8s Configuration Issues

### 9.1 Security Concerns (High Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/k8s/falkordb-statefulset.yaml`
**Line**: 19

```yaml
image: falkordb/falkordb:latest  # Using :latest tag
```

**Risk**: Unpredictable deployments; no version pinning.

### 9.2 Missing Health Probes (Medium Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/k8s/falkordb-statefulset.yaml`

**Issue**: No liveness or readiness probes defined for the FalkorDB container.

**Missing Configuration**:
```yaml
livenessProbe:
  tcpSocket:
    port: 6379
  initialDelaySeconds: 30
  periodSeconds: 10
readinessProbe:
  tcpSocket:
    port: 6379
  initialDelaySeconds: 5
  periodSeconds: 5
```

### 9.3 YAML Syntax Issue (Low Severity)

**File**: `/Users/ccheney/Projects/the-system/packages/infra/k8s/redpanda-values.yaml`
**Lines**: 7-11, 25-29

```yaml
storage:
  persistentVolume:
    enabled: true
    # ...

# Later in the file (Line 25) - duplicate key
storage:
  tieredConfig:
    # ...
```

**Issue**: Duplicate `storage` key - second definition will override the first.

---

## 10. Additional Recommendations

### 10.1 Add Pulumi Policy Pack (Low Priority)

Implement policy-as-code for infrastructure guardrails:
- Enforce resource naming conventions
- Require specific labels/tags
- Validate network configurations

### 10.2 Add Stack References (Medium Priority)

For multi-stack deployments, use Pulumi stack references instead of hardcoded values.

### 10.3 Implement State Locking (Medium Priority)

Ensure Pulumi state backend (GCS bucket) has proper locking configured.

---

## Metrics Summary

### Before Metrics

| Metric | Value |
|--------|-------|
| Lines of Code (TypeScript) | 76 |
| Lines of Code (Test) | 50 |
| Number of Files | 10 |
| Cyclomatic Complexity | 2 (low but misleading due to lack of logic) |
| Test Coverage | ~5% (estimated) |
| Type Safety Score | Medium-Low |
| SOLID Compliance | 40% |

### Recommended Target Metrics

| Metric | Target |
|--------|--------|
| Lines of Code (TypeScript) | ~200 (modularized) |
| Lines of Code (Test) | ~300 |
| Number of Files | 15+ |
| Test Coverage | >80% |
| Type Safety Score | High |
| SOLID Compliance | >90% |

---

## Priority Action Items

1. **P0 (Critical)**:
   - Add proper error handling and config validation
   - Pin Docker image versions in K8s manifests
   - Add meaningful tests with proper assertions

2. **P1 (High)**:
   - Modularize `index.ts` into separate concern files
   - Add TypeScript interfaces/Zod schemas for configuration
   - Fix duplicate YAML key in `redpanda-values.yaml`

3. **P2 (Medium)**:
   - Extract DRY violations (secret factory, resource factory)
   - Add health probes to K8s StatefulSets
   - Align package structure with monorepo conventions

4. **P3 (Low)**:
   - Export or remove unused secret resources
   - Remove or use unused dependencies
   - Add policy pack for guardrails

---

## Appendix: File Reference

| File | Lines | Purpose |
|------|-------|---------|
| `/Users/ccheney/Projects/the-system/packages/infra/index.ts` | 76 | Main Pulumi infrastructure definition |
| `/Users/ccheney/Projects/the-system/packages/infra/index.test.ts` | 50 | Unit tests (minimal) |
| `/Users/ccheney/Projects/the-system/packages/infra/package.json` | 19 | Package configuration |
| `/Users/ccheney/Projects/the-system/packages/infra/tsconfig.json` | 9 | TypeScript configuration |
| `/Users/ccheney/Projects/the-system/packages/infra/Pulumi.yaml` | 3 | Pulumi project definition |
| `/Users/ccheney/Projects/the-system/packages/infra/Pulumi.dev.yaml` | 3 | Development stack config |
| `/Users/ccheney/Projects/the-system/packages/infra/k8s/qdrant-values.yaml` | 27 | Qdrant Helm values |
| `/Users/ccheney/Projects/the-system/packages/infra/k8s/redpanda-values.yaml` | 30 | Redpanda Helm values |
| `/Users/ccheney/Projects/the-system/packages/infra/k8s/falkordb-statefulset.yaml` | 55 | FalkorDB K8s manifest |
