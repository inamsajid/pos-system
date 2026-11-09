import { offlineDb, NorthstarOfflineDatabase } from '../database'
import type { OutboxCommandRecord, OutboxStats } from './outbox.types'
import { OutboxConflictError, OutboxLeaseExpiredError } from './outbox.errors'
import { createLease, isLeaseValid } from './outbox.lease'

export class OutboxRepository {
  private readonly db: NorthstarOfflineDatabase

  constructor(db: NorthstarOfflineDatabase = offlineDb) {
    this.db = db
  }

  async findById(id: string): Promise<OutboxCommandRecord | undefined> {
    return this.db.outboxCommands.get(id)
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
   * Atomically claims a batch of eligible commands for processing using lease fencing.
   * Eligible commands:
   * 1. Status 'pending'
   * 2. Status 'retryable' where nextAttemptAt <= now
   * 3. Abandoned leases: status in ('leased', 'sending') where leaseExpiresAt <= now
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
      // Find candidate records matching user and business
      const allUserCommands = await this.db.outboxCommands
        .where('[userId+businessId+status]')
        .anyOf([
          [userId, businessId, 'pending'],
          [userId, businessId, 'retryable'],
          [userId, businessId, 'leased'],
          [userId, businessId, 'sending'],
        ])
        .toArray()

      const eligible: OutboxCommandRecord[] = []

      for (const cmd of allUserCommands) {
        if (eligible.length >= limit) break

        // Branch filter if specified
        if (branchId && cmd.branchId && cmd.branchId !== branchId) {
          continue
        }

        if (cmd.status === 'pending') {
          eligible.push(cmd)
        } else if (cmd.status === 'retryable') {
          if (!cmd.nextAttemptAt || new Date(cmd.nextAttemptAt).getTime() <= now) {
            eligible.push(cmd)
          }
        } else if (cmd.status === 'leased' || cmd.status === 'sending') {
          // Abandoned lease recovery
          if (cmd.leaseExpiresAt && new Date(cmd.leaseExpiresAt).getTime() <= now) {
            eligible.push(cmd)
          }
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
