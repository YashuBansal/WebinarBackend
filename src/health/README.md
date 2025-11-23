# Health Check Module

A production-grade health check system for the Webinar Leads Hub backend application.

## Overview

This module provides Kubernetes-compatible health check endpoints that can be used by load balancers, orchestration systems, and monitoring tools to determine the application's health status.

## Endpoints

All endpoints are prefixed with `/api/v1/health` (based on the global prefix configured in `main.ts`).

### 1. Liveness Probe
**Endpoint:** `GET /api/v1/health/live`

A simple endpoint that returns `200 OK` if the HTTP server is responsive. No database or external service checks are performed.

**Response:**
```json
{
  "status": "ok"
}
```

**Use Case:** Kubernetes liveness probe to determine if the container should be restarted.

### 2. Startup Probe
**Endpoint:** `GET /api/v1/health/startup`

Checks if the application has completed initialization. Returns `200 OK` once startup is complete (after ~5 seconds), otherwise returns `503 Service Unavailable`.

**Response:**
```json
{
  "status": "up",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "0.0.1",
  "checks": {
    "startup": {
      "status": "up",
      "message": "Application startup complete"
    }
  }
}
```

**Use Case:** Kubernetes startup probe to determine when the application is ready to receive traffic after container startup.

### 3. Readiness Probe
**Endpoint:** `GET /api/v1/health/ready`

Comprehensive health check that verifies critical dependencies (database) and soft dependencies (SMTP, Cloudinary). Results are cached for 12 seconds to prevent database overload.

**Query Parameters:**
- `skipCache` (optional): Set to `true` to bypass cache and get fresh results

**Response:**
```json
{
  "status": "up",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "0.0.1",
  "checks": {
    "database": {
      "status": "up",
      "latency": 15,
      "message": "Database connection healthy"
    },
    "smtp": {
      "status": "up",
      "latency": 2,
      "message": "SMTP configuration present"
    },
    "cloudinary": {
      "status": "up",
      "latency": 1,
      "message": "Cloudinary configuration present"
    }
  }
}
```

**Status Codes:**
- `200 OK`: Application is healthy (status: "up" or "degraded")
- `503 Service Unavailable`: Critical dependency is down (status: "down")

**Use Case:** Kubernetes readiness probe to determine if the application should receive traffic.

### 4. Combined Health Check
**Endpoint:** `GET /api/v1/health`

Alias for the readiness probe. Returns the same response as `/health/ready`.

## Health Check Logic

### Critical Dependencies
- **Database (MongoDB)**: If this check fails, the overall status is `down` and HTTP `503` is returned.

### Soft Dependencies
- **SMTP**: If this check fails, the status is marked as `degraded` but HTTP `200` is still returned.
- **Cloudinary**: If this check fails, the status is marked as `degraded` but HTTP `200` is still returned.

### Status Values
- `up`: Service is healthy and operational
- `down`: Critical service is unavailable (returns HTTP 503)
- `degraded`: Non-critical service is unavailable (returns HTTP 200)

## Features

### 1. Result Caching
Health check results are cached for 12 seconds to prevent:
- Database overload from frequent health checks
- Excessive external API calls
- Performance degradation

Use `?skipCache=true` query parameter to bypass cache when needed.

### 2. Timeout Protection
Each individual check has a strict 2-second timeout. If a check exceeds this timeout, it's marked as failed rather than hanging the entire health check.

### 3. Security
- Stack traces and sensitive error messages are sanitized from responses
- No internal error details are exposed to clients
- Generic error messages are returned for configuration issues

### 4. Version Information
The application version is automatically read from `package.json` or the `APP_VERSION` environment variable.

## Configuration

### Environment Variables
- `APP_VERSION`: Optional. Overrides version from `package.json`
- `MONGO_URI`: Required for database health check
- `MAILDEV_INCOMING_USER`: Required for SMTP health check
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: Required for Cloudinary health check

### Customization
To modify cache TTL or check timeouts, edit the constants in `health.service.ts`:
```typescript
private readonly CACHE_TTL = 12000; // 12 seconds
private readonly CHECK_TIMEOUT = 2000; // 2 seconds
```

## Kubernetes Configuration Example

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: webinar-leads-hub-backend
    livenessProbe:
      httpGet:
        path: /api/v1/health/live
        port: 3001
      initialDelaySeconds: 30
      periodSeconds: 10
      timeoutSeconds: 5
      failureThreshold: 3
    startupProbe:
      httpGet:
        path: /api/v1/health/startup
        port: 3001
      initialDelaySeconds: 0
      periodSeconds: 5
      timeoutSeconds: 3
      failureThreshold: 30
    readinessProbe:
      httpGet:
        path: /api/v1/health/ready
        port: 3001
      initialDelaySeconds: 5
      periodSeconds: 10
      timeoutSeconds: 5
      failureThreshold: 3
```

## Testing

### Manual Testing
```bash
# Liveness check
curl http://localhost:3001/api/v1/health/live

# Startup check
curl http://localhost:3001/api/v1/health/startup

# Readiness check (cached)
curl http://localhost:3001/api/v1/health/ready

# Readiness check (fresh)
curl http://localhost:3001/api/v1/health/ready?skipCache=true
```

### Expected Behavior
1. All endpoints should return quickly (< 100ms for cached, < 3s for fresh)
2. Database down should return HTTP 503 on readiness probe
3. SMTP/Cloudinary down should return HTTP 200 with "degraded" status
4. Cache should prevent repeated database queries within 12 seconds

## Monitoring Integration

The health check endpoints can be integrated with monitoring tools like:
- Prometheus (via exporter)
- Datadog
- New Relic
- Custom monitoring dashboards

The JSON response format is standardized and can be easily parsed by monitoring systems.

## Troubleshooting

### Health check returns 503
- Check MongoDB connection string (`MONGO_URI`)
- Verify MongoDB is running and accessible
- Check network connectivity

### Health check is slow
- Verify cache is working (check logs for "Returning cached health check result")
- Check database performance
- Consider increasing `CACHE_TTL` if appropriate

### Version shows as "unknown"
- Ensure `package.json` exists in the project root
- Set `APP_VERSION` environment variable as fallback

