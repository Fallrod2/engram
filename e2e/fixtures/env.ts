/**
 * Fixed ports/URLs for the e2e stack (Phase 7 §1.3). Deliberately NOT the
 * 300x/517x ranges used by the orchestrator/dev/reviewer live servers — 3100
 * (API) and 5273 (web) are reserved for the e2e run alone. A single `test:e2e`
 * invocation at a time is assumed (§8 Risques).
 */
export const PORTS = { api: 3100, web: 5273 } as const

export const API_BASE = `http://localhost:${PORTS.api}`
export const API_HEALTH_URL = `${API_BASE}/api/health`
export const WEB_URL = `http://localhost:${PORTS.web}`
