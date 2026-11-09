# Step 14.3 Staff Management Architecture & Security Audit

**Date**: November 9, 2026  
**System**: Point of Sale & Multi-Tenant Retail Management System  
**Stage**: Step 14.3 — Complete Staff Management Module Audit  
**Auditor/Implementer**: Google Antigravity (Gemini 3.8 Flash High)

---

## 1. Executive Summary

This audit assesses the existing user authentication, business membership, branch assignment, session management, and role-based access control (RBAC) foundation in preparation for the complete **Staff Management** module.

Staff in this application are modeled as **multi-tenant business members** rather than isolated standalone POS users. A single global user identity (`users` table) can participate in multiple business organizations (`businesses` table) with completely distinct roles and branch assignments across each tenancy.

---

## 2. Core Domain Data Model

### 2.1 Multi-Tenant Separation

```
[ Global User Account ]
      id: usr_...
      email: string (unique)
      name, phone, status: ('active', 'inactive', 'banned')
           │
           ├── (1:N) ── [ Business Memberships ]
           │                 id: bm_...
           │                 business_id: biz_...
           │                 user_id: usr_...
           │                 role: ('owner' | 'admin' | 'manager' | 'cashier' | 'accountant' | 'inventory_manager')
           │                 is_active: 0 | 1
           │                      │
           │                      └── (1:N) ── [ Member Branches ]
           │                                        id: mb_...
           │                                        member_id: bm_...
           │                                        branch_id: br_...
           │
           └── (1:N) ── [ Sessions ]
                             id: sess_...
                             user_id: usr_...
                             token_hash, expires_at
```

### 2.2 Key Invariants
1. **Multi-Business Role Orthogonality**:
   - A user can be an `owner` in Business A and a `cashier` in Business B.
   - Suspending or demoting a user's membership in Business A has **zero effect** on their status or privileges in Business B.
2. **Account vs. Membership Suspension**:
   - `users.status`: System-wide account status (`active`, `inactive`, `banned`). Only platform operators can ban a global user.
   - `business_members.is_active`: Tenancy-specific membership flag (`1` = active, `0` = suspended).
3. **No Cascade-Deletion of Financial History**:
   - When a staff member departs, their `business_members` row is marked `is_active = 0` (suspended).
   - Past sales, invoices, purchases, payments, and audit logs retain immutable foreign key integrity.

---

## 3. Role-Based Access Control (RBAC) Matrix

The server-authoritative role matrix is defined in `worker/src/auth/tenantContext.ts`:

| Permission | Owner | Admin | Manager | Cashier | Inventory Mgr | Accountant |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `manage_settings` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `manage_staff` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `catalog_read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `catalog_write` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `pos_sale` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `collect_payments` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| `stock_adjustment` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `stocktake_confirm` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `purchase_order` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `receive_goods` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `disburse_payments`| ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `reports_view` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `export_backup` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `expenses_read` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| `expenses_write` | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |

### Staff Management Guardrails
- Only `owner` and `admin` hold `manage_staff`.
- `owner` role protection:
  - An `admin` cannot invite, promote, demote, or suspend an `owner`.
  - The last active `owner` of a business cannot be suspended or demoted.
  - Users cannot self-suspend or self-demote.

---

## 4. Branch Assignments & Tenant Scoping

- **Owners and Admins**: By policy, have full visibility and transaction privileges across **all branches** within their business.
- **Managers, Cashiers, and Inventory Staff**: Can be assigned to specific authorized branches via `member_branches`.
- **Enforcement**:
  - `resolveAuthorizedBranchIds` in `worker/src/auth/tenantContext.ts` evaluates authorized branch IDs.
  - Mutations outside authorized branch IDs are rejected with HTTP 403 Forbidden.
  - Cross-business branch assignment is strictly prevented.

---

## 5. Staff Onboarding & Invitations

- **Database Table**: `staff_invitations` (defined in migration `0014_expenses_and_staff.sql`).
- **Cryptographic Security**:
  - Invitations generate a 24-byte cryptographically secure random token.
  - Only the SHA-256 digest `token_hash` is stored in Cloudflare D1.
  - Raw tokens are never logged or stored in plain text.
- **Expiration & Lifecycle**:
  - 7-day automatic expiry (`expires_at`).
  - Single-use flag (`used_at`).
  - Explicit revocation (`POST /api/v1/staff/invitations/:id/revoke`).
- **Email Delivery Decision**:
  - Since no external transactional email provider (SendGrid, Mailgun, Postmark) is configured in Cloudflare Workers, the invitation workflow provides an authorized, cryptographically signed onboarding invitation link directly in the admin UI.
  - The UI explicitly states the onboarding link was generated for manual distribution and does not falsely claim an automated email was sent.

---

## 6. Audit Trail & Compliance

Every staff management mutation logs an immutable record to `audit_logs`:
- `invite_staff`
- `revoke_invitation`
- `accept_invitation`
- `update_staff_role`
- `update_staff_branches`
- `suspend_staff`
- `reactivate_staff`

Sensitive fields (passwords, raw invitation tokens, session hashes) are strictly excluded from audit diffs.

---

## 7. Audit Conclusion & Implementation Plan

All necessary schema tables (`users`, `business_members`, `member_branches`, `staff_invitations`, `audit_logs`) are present in local D1.
Next steps:
1. Implement `GET /api/v1/staff/:id/permissions`, `GET /api/v1/staff/:id/branches`, and `POST /api/v1/staff/invitations/accept`.
2. Expand frontend modular architecture in `src/features/staff/`.
3. Connect with TanStack Query hooks and modals.
4. Execute full testing and verification.

