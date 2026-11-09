import type {
  StaffMemberDTO,
  StaffInvitationDTO,
  StaffFilterParams,
  AssignedBranchDTO,
} from './staff.types'

export class StaffRepository {
  private readonly db: D1Database

  constructor(db: D1Database) {
    this.db = db
  }

  async listStaffMembers(businessId: string, filters: StaffFilterParams = {}): Promise<StaffMemberDTO[]> {
    const conditions: string[] = ['bm.business_id = ?']
    const params: unknown[] = [businessId]

    if (filters.role) {
      conditions.push('bm.role = ?')
      params.push(filters.role)
    }

    if (filters.isActive !== undefined) {
      conditions.push('bm.is_active = ?')
      params.push(filters.isActive ? 1 : 0)
    }

    if (filters.search) {
      conditions.push('(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)')
      const pattern = `%${filters.search}%`
      params.push(pattern, pattern, pattern)
    }

    const sql = `
      SELECT
        bm.id,
        bm.user_id,
        bm.business_id,
        bm.role,
        bm.is_active,
        bm.created_at,
        u.name,
        u.email,
        u.phone,
        u.status
      FROM business_members bm
      INNER JOIN users u ON u.id = bm.user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY bm.created_at ASC
    `

    const result = await this.db.prepare(sql).bind(...params).all<any>()
    const members = result.results || []

    if (members.length === 0) return []

    // Fetch branches for all members in this business
    const branchSql = `
      SELECT
        mb.member_id,
        b.id AS branch_id,
        b.name AS branch_name,
        b.branch_code
      FROM member_branches mb
      INNER JOIN branches b ON b.id = mb.branch_id
      INNER JOIN business_members bm ON bm.id = mb.member_id
      WHERE bm.business_id = ?
    `
    const branchResult = await this.db.prepare(branchSql).bind(businessId).all<any>()
    const branchesByMember = new Map<string, AssignedBranchDTO[]>()

    for (const row of branchResult.results || []) {
      const list = branchesByMember.get(row.member_id) || []
      list.push({
        id: row.branch_id,
        name: row.branch_name,
        branchCode: row.branch_code,
      })
      branchesByMember.set(row.member_id, list)
    }

    let items: StaffMemberDTO[] = members.map(r => ({
      id: r.id,
      userId: r.user_id,
      businessId: r.business_id,
      name: r.name,
      email: r.email,
      phone: r.phone || null,
      role: r.role,
      isActive: Boolean(r.is_active),
      status: r.status,
      createdAt: r.created_at,
      assignedBranches: branchesByMember.get(r.id) || [],
    }))

    if (filters.branchId) {
      items = items.filter(m => m.assignedBranches.some(b => b.id === filters.branchId))
    }

    return items
  }

  async getStaffMemberById(businessId: string, memberId: string): Promise<StaffMemberDTO | null> {
    const sql = `
      SELECT
        bm.id,
        bm.user_id,
        bm.business_id,
        bm.role,
        bm.is_active,
        bm.created_at,
        u.name,
        u.email,
        u.phone,
        u.status
      FROM business_members bm
      INNER JOIN users u ON u.id = bm.user_id
      WHERE bm.business_id = ? AND bm.id = ?
      LIMIT 1
    `
    const row = await this.db.prepare(sql).bind(businessId, memberId).first<any>()
    if (!row) return null

    const branchSql = `
      SELECT
        b.id AS branch_id,
        b.name AS branch_name,
        b.branch_code
      FROM member_branches mb
      INNER JOIN branches b ON b.id = mb.branch_id
      WHERE mb.member_id = ?
    `
    const branchResult = await this.db.prepare(branchSql).bind(memberId).all<any>()
    const assignedBranches: AssignedBranchDTO[] = (branchResult.results || []).map(b => ({
      id: b.branch_id,
      name: b.branch_name,
      branchCode: b.branch_code,
    }))

    return {
      id: row.id,
      userId: row.user_id,
      businessId: row.business_id,
      name: row.name,
      email: row.email,
      phone: row.phone || null,
      role: row.role,
      isActive: Boolean(row.is_active),
      status: row.status,
      createdAt: row.created_at,
      assignedBranches,
    }
  }

  async getStaffMemberByUserId(businessId: string, userId: string): Promise<StaffMemberDTO | null> {
    const sql = `
      SELECT bm.id
      FROM business_members bm
      WHERE bm.business_id = ? AND bm.user_id = ?
      LIMIT 1
    `
    const row = await this.db.prepare(sql).bind(businessId, userId).first<{ id: string }>()
    if (!row) return null
    return this.getStaffMemberById(businessId, row.id)
  }

  async countActiveOwners(businessId: string): Promise<number> {
    const sql = `
      SELECT COUNT(*) AS total
      FROM business_members
      WHERE business_id = ? AND role = 'owner' AND is_active = 1
    `
    const row = await this.db.prepare(sql).bind(businessId).first<{ total: number }>()
    return row?.total ?? 0
  }

  async updateMemberRole(businessId: string, memberId: string, role: string): Promise<void> {
    const sql = `
      UPDATE business_members
      SET role = ?, updated_at = datetime('now')
      WHERE business_id = ? AND id = ?
    `
    await this.db.prepare(sql).bind(role, businessId, memberId).run()
  }

  async updateMemberBranches(memberId: string, branchIds: string[]): Promise<void> {
    // Delete existing
    await this.db.prepare(`DELETE FROM member_branches WHERE member_id = ?`).bind(memberId).run()

    // Insert new
    for (const branchId of branchIds) {
      const id = `mb-${crypto.randomUUID()}`
      await this.db
        .prepare(`INSERT INTO member_branches (id, member_id, branch_id, created_at) VALUES (?, ?, ?, datetime('now'))`)
        .bind(id, memberId, branchId)
        .run()
    }
  }

  async setMemberActiveStatus(businessId: string, memberId: string, isActive: boolean): Promise<void> {
    const sql = `
      UPDATE business_members
      SET is_active = ?, updated_at = datetime('now')
      WHERE business_id = ? AND id = ?
    `
    await this.db.prepare(sql).bind(isActive ? 1 : 0, businessId, memberId).run()
  }

  async createInvitation(
    id: string,
    businessId: string,
    email: string,
    role: string,
    tokenHash: string,
    branchIdsJson: string | null,
    invitedBy: string,
    expiresAt: string
  ): Promise<void> {
    const sql = `
      INSERT INTO staff_invitations (
        id,
        business_id,
        email,
        role,
        token_hash,
        branch_ids_json,
        invited_by,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `
    await this.db
      .prepare(sql)
      .bind(id, businessId, email, role, tokenHash, branchIdsJson, invitedBy, expiresAt)
      .run()
  }

  async listPendingInvitations(businessId: string): Promise<StaffInvitationDTO[]> {
    const sql = `
      SELECT
        si.id,
        si.business_id,
        si.email,
        si.role,
        si.branch_ids_json,
        si.invited_by,
        u.name AS invited_by_name,
        si.expires_at,
        si.used_at,
        si.created_at
      FROM staff_invitations si
      LEFT JOIN users u ON u.id = si.invited_by
      WHERE si.business_id = ? AND si.used_at IS NULL AND si.expires_at > datetime('now')
      ORDER BY si.created_at DESC
    `
    const result = await this.db.prepare(sql).bind(businessId).all<any>()
    return (result.results || []).map(r => {
      let branchIds: string[] = []
      try {
        if (r.branch_ids_json) {
          branchIds = JSON.parse(r.branch_ids_json)
        }
      } catch {}

      return {
        id: r.id,
        businessId: r.business_id,
        email: r.email,
        role: r.role,
        branchIds,
        invitedBy: r.invited_by,
        invitedByName: r.invited_by_name || undefined,
        expiresAt: r.expires_at,
        usedAt: r.used_at || null,
        createdAt: r.created_at,
      }
    })
  }

  async revokeInvitation(businessId: string, invitationId: string): Promise<void> {
    const sql = `DELETE FROM staff_invitations WHERE business_id = ? AND id = ? AND used_at IS NULL`
    await this.db.prepare(sql).bind(businessId, invitationId).run()
  }

  async getInvitationByTokenHash(tokenHash: string): Promise<{
    id: string
    business_id: string
    email: string
    role: string
    branch_ids_json: string | null
    invited_by: string
    expires_at: string
    used_at: string | null
  } | null> {
    const sql = `
      SELECT id, business_id, email, role, branch_ids_json, invited_by, expires_at, used_at
      FROM staff_invitations
      WHERE token_hash = ?
      LIMIT 1
    `
    return this.db.prepare(sql).bind(tokenHash).first<any>()
  }

  async markInvitationUsed(invitationId: string): Promise<void> {
    const sql = `UPDATE staff_invitations SET used_at = datetime('now') WHERE id = ?`
    await this.db.prepare(sql).bind(invitationId).run()
  }

  async upsertBusinessMember(
    id: string,
    businessId: string,
    userId: string,
    role: string
  ): Promise<string> {
    const existing = await this.db
      .prepare(`SELECT id FROM business_members WHERE business_id = ? AND user_id = ? LIMIT 1`)
      .bind(businessId, userId)
      .first<{ id: string }>()

    if (existing) {
      await this.db
        .prepare(`UPDATE business_members SET role = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?`)
        .bind(role, existing.id)
        .run()
      return existing.id
    }

    await this.db
      .prepare(
        `INSERT INTO business_members (id, business_id, user_id, role, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
      )
      .bind(id, businessId, userId, role)
      .run()

    return id
  }

  async insertAuditLog(
    businessId: string,
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    diffJson?: string
  ): Promise<void> {
    const id = `aud-${crypto.randomUUID()}`
    const sql = `
      INSERT INTO audit_logs (id, business_id, branch_id, user_id, action, entity_type, entity_id, diff_json, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, datetime('now'))
    `
    await this.db
      .prepare(sql)
      .bind(id, businessId, userId, action, entityType, entityId, diffJson || null)
      .run()
  }
}

