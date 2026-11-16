import { offlineDb, NorthstarOfflineDatabase } from '../database'
import type { OutboxCommandRecord, OutboxStats } from './outbox.types'
import { OutboxConflictError, OutboxLeaseExpiredError } from './outbox.errors'
import { createLease, isLeaseValid } from './outbox.lease'

export class OutboxRepository {
  private readonly db: NorthstarOfflineDatabase

  constructor(db: NorthstarOfflineDatabase = offlineDb) {
    this.db = db
  }

  getDb(): NorthstarOfflineDatabase {
    return this.db
  }

  async findById(id: string): Promise<OutboxCommandRecord | undefined> {
    return this.db.outboxCommands.get(id)
  }

  async listByTenant(userId: string, businessId: string): Promise<OutboxCommandRecord[]> {
    const records = await this.db.outboxCommands
      .filter((c) => c.userId === userId && c.businessId === businessId)
      .toArray()
    records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
    return records
  }

  async findByIdempotencyKey(
    businessId: string,
    idempotencyKey: string
  ): Promise<OutboxCommandRecord | undefined> {
    const records = await this.db.outboxCommands
      .where('idempotencyKey')
      .equals(idempotencyKey)
      .toArray()
    return records.find((r) => r.businessId === businessId)
  }

  async save(record: OutboxCommandRecord): Promise<OutboxCommandRecord> {
    await this.db.outboxCommands.put(record)
    return record
  }

  /**
   * Durably enqueues a command inside an atomic Dexie transaction.
   * Protects against duplicate IDs and mismatched payload reuse on the same idempotency key.
   */
  async atomicEnqueue(record: OutboxCommandRecord): Promise<OutboxCommandRecord> {
    return this.db.transaction('rw', this.db.outboxCommands, async () => {
      // Check for duplicate command ID
      const existingById = await this.db.outboxCommands.get(record.id)
      if (existingById) {
        throw new OutboxConflictError(
          `Command with ID '${record.id}' already exists in outbox storage.`
        )
      }

      // Check for existing record with the same idempotency key in this business
      const existingByIdem = await this.db.outboxCommands
        .where('idempotencyKey')
        .equals(record.idempotencyKey)
        .first()

      if (existingByIdem && existingByIdem.businessId === record.businessId) {
        if (existingByIdem.payloadHash !== record.payloadHash) {
          throw new OutboxConflictError(
            `Idempotency violation: Idempotency key '${record.idempotencyKey}' was previously enqueued with a different payload hash.`
          )
        }
        // Identical idempotency key and payload hash: return existing record without duplicate
        return existingByIdem
      }

      await this.db.outboxCommands.put(record)
      return record
    })
  }

  /**
   * Atomically claims a FIFO batch of eligible commands for processing using lease fencing.
   * Stops cleanly before any unresolved blocking head-of-line command (blocked_auth, conflict,
   * reconciliation_required, active unexpired lease, or future backoff retryable).
   */
  async claimEligibleBatch(params: {
    userId: string
    businessId: string
    branchId?: string | null
    limit?: number
    leaseDurationMs?: number
  }): Promise<OutboxCommandRecord[]> {
    const { userId, businessId, branchId = null, limit = 10, leaseDurationMs } = params
    const now = Date.now()
    const nowIso = new Date(now).toISOString()

    return this.db.transaction('rw', this.db.outboxCommands, async () => {
      const activeUserCommands = await this.db.outboxCommands
        .where('[userId+businessId+status]')
        .anyOf([
          [userId, businessId, 'pending'],
          [userId, businessId, 'retryable'],
          [userId, businessId, 'leased'],
          [userId, businessId, 'sending'],
          [userId, businessId, 'blocked_auth'],
          [userId, businessId, 'conflict'],
          [userId, businessId, 'reconciliation_required'],
        ])
        .toArray()

      const scoped = activeUserCommands
        .filter((cmd) => !(branchId && cmd.branchId && cmd.branchId !== branchId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))

      const eligible: OutboxCommandRecord[] = []

      for (const cmd of scoped) {
        if (eligible.length >= limit) break

        if (
          cmd.status === 'blocked_auth' ||
          cmd.status === 'conflict' ||
          cmd.status === 'reconciliation_required'
        ) {
          // Strict FIFO head-of-line blocking until operator resolves or re-authenticates
          break
        }

        if (cmd.status === 'leased' || cmd.status === 'sending') {
          if (cmd.leaseExpiresAt && new Date(cmd.leaseExpiresAt).getTime() <= now) {
            eligible.push(cmd)
          } else {
            // Active lease at queue head blocks trailing commands until settled
            break
          }
        } else if (cmd.status === 'retryable') {
          if (!cmd.nextAttemptAt || new Date(cmd.nextAttemptAt).getTime() <= now) {
            eligible.push(cmd)
          } else {
            break
          }
        } else if (cmd.status === 'pending') {
          eligible.push(cmd)
        }
      }

      const claimed: OutboxCommandRecord[] = []
      for (const cmd of eligible) {
        const lease = createLease(leaseDurationMs)
        const updated: OutboxCommandRecord = {
          ...cmd,
          status: 'leased',
          attemptCount: cmd.attemptCount + 1,
          leaseToken: lease.leaseToken,
          leaseExpiresAt: lease.leaseExpiresAt,
          lastAttemptAt: nowIso,
          updatedAt: nowIso,
        }
        await this.db.outboxCommands.put(updated)
        claimed.push(updated)
      }

      return claimed
    })
  }

  /**
   * Releases unclaimed trailing leases after a batch halts early on a blocker.
   */
  async releaseLeases(commands: Array<{ id: string; leaseToken: string | null }>): Promise<void> {
    if (commands.length === 0) return
    const nowIso = new Date().toISOString()

    await this.db.transaction('rw', this.db.outboxCommands, async () => {
      for (const { id, leaseToken } of commands) {
        const existing = await this.db.outboxCommands.get(id)
        if (!existing || existing.status !== 'leased' || existing.leaseToken !== leaseToken) {
          continue
        }
        await this.db.outboxCommands.put({
          ...existing,
          status: 'pending',
          attemptCount: Math.max(0, existing.attemptCount - 1),
          nextAttemptAt: nowIso,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: nowIso,
        })
      }
    })
  }

  /**
   * Re-queues blocked_auth commands once user re-authenticates cleanly.
   */
  async resumeAuthBlocked(userId: string, businessId?: string): Promise<number> {
    const nowIso = new Date().toISOString()
    return this.db.transaction('rw', this.db.outboxCommands, async () => {
      const blocked = await this.db.outboxCommands
        .filter(
          (c) =>
            c.userId === userId &&
            c.status === 'blocked_auth' &&
            (!businessId || c.businessId === businessId)
        )
        .toArray()

      for (const cmd of blocked) {
        await this.db.outboxCommands.put({
          ...cmd,
          status: 'pending',
          nextAttemptAt: nowIso,
          leaseToken: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          updatedAt: nowIso,
        })
      }

      return blocked.length
    })
  }

  /**
   * Updates command status while verifying that the caller still holds a valid active lease.
   */
  async updateWithLeaseCheck(
    id: string,
    leaseToken: string,
    updates: Partial<OutboxCommandRecord>
  ): Promise<OutboxCommandRecord> {
    return this.db.transaction('rw', this.db.outboxCommands, async () => {
      const existing = await this.db.outboxCommands.get(id)
      if (!existing) {
        throw new Error(`Command '${id}' not found.`)
      }

      if (!isLeaseValid(existing, leaseToken)) {
        throw new OutboxLeaseExpiredError(
          `Cannot update command '${id}': Lease token mismatch or lease expired.`
        )
      }

      const updated: OutboxCommandRecord = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      }

      // If transitioning to a non-active status, release lease fields
      if (['acknowledged', 'rejected', 'conflict', 'blocked_auth', 'cancelled', 'reconciliation_required'].includes(updated.status)) {
        updated.leaseToken = null
        updated.leaseExpiresAt = null
      }

      await this.db.outboxCommands.put(updated)
      return updated
    })
  }

  /**
   * Calculates comprehensive outbox status metrics for a given user and business.
   */
  async getStats(userId: string, businessId: string): Promise<OutboxStats> {
    const records = await this.db.outboxCommands
      .filter((c) => c.userId === userId && c.businessId === businessId)
      .toArray()

    let pendingCount = 0
    let processingCount = 0
    let retryableCount = 0
    let conflictCount = 0
    let rejectedCount = 0
    let blockedAuthCount = 0
    let acknowledgedCount = 0
    let reconciliationRequiredCount = 0
    let latestAckAt: string | null = null

    for (const r of records) {
      switch (r.status) {
        case 'pending':
          pendingCount++
          break
        case 'leased':
        case 'sending':
          processingCount++
          break
        case 'retryable':
          retryableCount++
          break
        case 'conflict':
          conflictCount++
          break
        case 'rejected':
          rejectedCount++
          break
        case 'blocked_auth':
          blockedAuthCount++
          break
        case 'reconciliation_required':
          reconciliationRequiredCount++
          break
        case 'acknowledged':
          acknowledgedCount++
          if (r.acknowledgedAt) {
            if (!latestAckAt || new Date(r.acknowledgedAt) > new Date(latestAckAt)) {
              latestAckAt = r.acknowledgedAt
            }
          }
          break
      }
    }

    return {
      pendingCount,
      processingCount,
      retryableCount,
      conflictCount,
      rejectedCount,
      blockedAuthCount,
      acknowledgedCount,
      reconciliationRequiredCount,
      lastSyncAt: latestAckAt,
    }
  }

  /**
   * Safely purges acknowledged commands older than the retention threshold.
   */
  async deleteAcknowledged(
    userId: string,
    businessId: string,
    olderThanMs = 7 * 24 * 60 * 60 * 1000 // 7 days default
  ): Promise<number> {
    const threshold = new Date(Date.now() - olderThanMs).toISOString()

    const toDelete = await this.db.outboxCommands
      .where('[userId+businessId+status]')
      .equals([userId, businessId, 'acknowledged'])
      .filter((c) => Boolean(c.acknowledgedAt && c.acknowledgedAt < threshold))
      .primaryKeys()

    await this.db.outboxCommands.bulkDelete(toDelete)
    return toDelete.length
  }
}

export const outboxRepository = new OutboxRepository()
