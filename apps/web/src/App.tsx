import { useEffect, useState } from 'react'
import type { HealthResponse } from '@engram/shared'

type ApiState =
  { kind: 'loading' } | { kind: 'ok'; data: HealthResponse } | { kind: 'error'; message: string }

export function App() {
  const [api, setApi] = useState<ApiState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch('/api/health')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as HealthResponse
        if (!cancelled) setApi({ kind: 'ok', data })
      } catch (err) {
        if (!cancelled) {
          setApi({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: '32rem',
        margin: '4rem auto',
        padding: '0 1.5rem',
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ fontWeight: 600, letterSpacing: '-0.02em' }}>engram</h1>
      <p style={{ color: '#666' }}>Self-hosted spaced-repetition dashboard.</p>
      <p>
        API status: {api.kind === 'loading' && <span>checking…</span>}
        {api.kind === 'ok' && (
          <span>
            {api.data.status} ({api.data.service})
          </span>
        )}
        {api.kind === 'error' && <span>unreachable — {api.message}</span>}
      </p>
    </main>
  )
}
