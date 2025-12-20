# Search-Py Rollback Runbook

This document describes procedures for rolling back from the Python search service (search-py) to the TypeScript search service (apps/search) if issues are encountered.

## Prerequisites

- Docker Compose access
- Shell access to the deployment environment
- Monitoring dashboard access (Grafana/Prometheus)

## Health Indicators

### Green (Healthy)
- `/health` endpoint returns 200
- `/metrics` shows steady request rates
- P95 latency < 500ms for search requests
- Error rate < 1%

### Yellow (Degraded)
- Elevated latency (P95 > 500ms but < 2s)
- Error rate between 1-5%
- Reranker fallback to lower tiers
- Embedder cache hit rate < 50%

### Red (Critical)
- `/health` returns non-200 or timeout
- Error rate > 5%
- P95 latency > 2s
- Service unreachable

## Rollback Procedures

### Immediate Rollback (< 5 minutes)

For critical issues requiring immediate action:

```bash
# 1. Stop search-py service
docker compose -f docker-compose.dev.yml stop search-py

# 2. Start TypeScript search service locally
cd apps/search && npm run dev

# 3. Verify health
curl http://localhost:5002/health
```

### Graceful Rollback (5-15 minutes)

For non-critical issues allowing graceful transition:

```bash
# 1. Scale down search-py (if using orchestrator)
# Or update docker-compose to comment out search-py

# 2. Update docker-compose.dev.yml
# Comment out search-py service, uncomment TypeScript search if present

# 3. Restart services
docker compose -f docker-compose.dev.yml up -d

# 4. Verify TypeScript service is healthy
curl http://localhost:5002/health
```

### Full Rollback (Production)

For production environments with traffic routing:

1. **Shift traffic away from search-py**
   - Update load balancer/ingress to route 100% to TypeScript service
   - Monitor for connection draining

2. **Verify TypeScript service**
   ```bash
   curl http://search-ts:5002/health
   ```

3. **Stop search-py instances**
   ```bash
   docker compose stop search-py
   ```

4. **Clear any Python-specific state**
   - Qdrant collections remain compatible
   - Redis pub/sub channels are shared

5. **Update deployment configs**
   - Revert Kubernetes/Docker configs
   - Update CI/CD to deploy TypeScript version

## Post-Rollback Verification

1. **Health checks**
   ```bash
   curl http://localhost:5002/health
   curl http://localhost:5002/metrics
   ```

2. **Functional verification**
   ```bash
   # Test search endpoint
   curl -X POST http://localhost:5002/search \
     -H "Content-Type: application/json" \
     -d '{"query": "test query", "limit": 5}'
   ```

3. **Monitor for 15 minutes**
   - Watch error rates
   - Check latency percentiles
   - Verify no connection leaks

## Common Issues and Fixes

### Issue: High latency after rollback
**Cause**: Model warming after restart
**Fix**: Wait 5-10 minutes for embedder models to warm up

### Issue: Kafka consumer lag
**Cause**: Events accumulated during rollback
**Fix**: Consumer will catch up; monitor lag metrics

### Issue: Redis connection errors
**Cause**: Connection pool exhaustion
**Fix**: Restart service to reset pool

## Rollback Decision Matrix

| Symptom | Severity | Action |
|---------|----------|--------|
| P95 > 2s sustained | Critical | Immediate rollback |
| Error rate > 10% | Critical | Immediate rollback |
| Service unreachable | Critical | Immediate rollback |
| P95 > 1s intermittent | Medium | Monitor 5 min, then decide |
| Error rate 5-10% | Medium | Investigate, rollback if no fix in 15 min |
| Cache miss spike | Low | Monitor, no rollback |
| Single failed request | Low | Log and investigate |

## Contacts

- On-call engineer: Check PagerDuty rotation
- Search team lead: See team roster
- Infrastructure: See platform team roster
