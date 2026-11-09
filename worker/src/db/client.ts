import type { DatabaseHealthResult } from './types'

/**
 * Executes a simple query on D1 to verify active connectivity.
 * Uses SELECT 1 as a lightweight heartbeat.
 */
export async function checkDatabaseConnectivity(db?: D1Database): Promise<DatabaseHealthResult> {
  if (!db) {
    return { connected: false, error: 'Database binding (DB) is missing from environment.' }
  }

  const start = Date.now()
  try {
    const result = await db.prepare('SELECT 1 as alive').first<{ alive: number }>()
    const latencyMs = Date.now() - start
    if (result && result.alive === 1) {
      return { connected: true, latencyMs }
    }
    return { connected: false, error: 'Unexpected response from database heartbeat query.' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { connected: false, error: message }
  }
}

