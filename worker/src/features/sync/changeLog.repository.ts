import type {
  SyncChangeLogRow,
  SyncResourceType,
  SyncOperation,
} from './sync.types'

export class ChangeLogRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  /**
   * Generates a prepared statement to append an event to `sync_change_log`.
   * Can be combined into D1 `db.batch()` transactions with the underlying business mutation.
   */
  createChangeEventStatement(params: {
    businessId: string
    branchId?: string | null
    resourceType: SyncResourceType
    resourceId: string
    resourceVersion: number
    operation: SyncOperation
    payload: Record<string, unknown>
    eventId: string
  }): D1PreparedStatement {
    const {
      businessId,
      branchId = null,
      resourceType,
      resourceId,
      resourceVersion,
      operation,
      payload,
      eventId,
    } = params

    return this.db
      .prepare(
        `INSERT INTO sync_change_log (
           business_id, branch_id, resource_type, resource_id, resource_version, operation, payload, event_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .bind(
        businessId,
        branchId,
        resourceType,
        resourceId,
        resourceVersion,
        operation,
        JSON.stringify(payload),
        eventId
      )
  }

  /**
   * Retrieves change log rows after sequence `afterSeq` ordered monotonically by ID.
   * Scopes to business and either business-wide changes (branch_id IS NULL) or branch-specific changes.
   */
  async getChanges(params: {
    businessId: string
    afterSeq: number
    limit: number
    branchId?: string | null
  }): Promise<{
    changes: SyncChangeLogRow[]
    maxSeq: number
    hasMore: boolean
  }> {
    const { businessId, afterSeq, limit, branchId } = params
    const safeLimit = Math.min(Math.max(1, limit), 100)

    let rows: SyncChangeLogRow[]

    if (branchId) {
      const result = await this.db
        .prepare(
          `SELECT id, business_id, branch_id, resource_type, resource_id, resource_version, operation, payload, event_id, created_at
           FROM sync_change_log
           WHERE business_id = ? AND id > ? AND (branch_id IS NULL OR branch_id = ?)
           ORDER BY id ASC
           LIMIT ?`
        )
        .bind(businessId, afterSeq, branchId, safeLimit + 1)
        .all<SyncChangeLogRow>()

      rows = result.results || []
    } else {
      const result = await this.db
        .prepare(
          `SELECT id, business_id, branch_id, resource_type, resource_id, resource_version, operation, payload, event_id, created_at
           FROM sync_change_log
           WHERE business_id = ? AND id > ? AND branch_id IS NULL
           ORDER BY id ASC
           LIMIT ?`
        )
        .bind(businessId, afterSeq, safeLimit + 1)
        .all<SyncChangeLogRow>()

      rows = result.results || []
    }

    const hasMore = rows.length > safeLimit
    const changes = hasMore ? rows.slice(0, safeLimit) : rows
    const lastRow = changes[changes.length - 1]
    const maxSeq = lastRow ? lastRow.id : afterSeq

    return {
      changes,
      maxSeq,
      hasMore,
    }
  }

  async getMaxSequence(businessId: string): Promise<number> {
    const row = await this.db
      .prepare(`SELECT MAX(id) as max_id FROM sync_change_log WHERE business_id = ?`)
      .bind(businessId)
      .first<{ max_id: number | null }>()

    return row?.max_id ?? 0
  }
}
