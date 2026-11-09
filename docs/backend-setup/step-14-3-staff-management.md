# Step 14.3 Implementation Report: Staff Management (Backend + Frontend)

**Date**: November 9, 2026  
**System**: Point of Sale & Retail Management System  
**Stage**: Step 14.3 — Staff & Team Management  
**Auditor/Implementer**: Google Antigravity (Gemini 3.8 Flash High)

---

## 1. Overview & Architecture

Step 14.3 completes the staff management lifecycle, role-based access control (RBAC), branch access scoping, and secure tokenized staff invitation workflows.

### Core Principles & Security Guardrails:
1. **Zero Self-Promotion or Privilege Escalation**:
   - Only `owner` and `admin` hold `manage_staff` permissions.
   - An `admin` cannot grant the `owner` role, promote themselves or others to `owner`, or suspend an `owner`.
   - A user cannot suspend or delete their own active credentials.
2. **Owner Retention Guardrail**:
   - The business must retain at least one active `owner` at all times. Demoting or suspending the final owner is rejected by the service layer.
3. **Cryptographically Secure Invitation Tokens**:
   - 24-byte cryptographically random hex tokens generated via Web Crypto API.
   - Only SHA-256 hashes (`token_hash`) are persisted to D1.
   - Invitations expire automatically after 7 days and can be revoked by an administrator prior to acceptance.
4. **Branch Access Restrictions**:
   - Staff members can be restricted to specific branches or given global access across all branches.

---

## 2. Database Schema (Migration `0014_expenses_and_staff.sql`)

```sql
CREATE TABLE IF NOT EXISTS staff_invitations (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'manager', 'cashier', 'accountant', 'inventory_manager')),
  token_hash TEXT NOT NULL UNIQUE,
  branch_ids_json TEXT,
  invited_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_staff_inv_biz ON staff_invitations(business_id);
CREATE INDEX IF NOT EXISTS idx_staff_inv_token ON staff_invitations(token_hash);
```

---

## 3. Cloudflare Worker API Endpoints

Implemented in `worker/src/features/staff/`:

| Method | Endpoint | Description | Guardrail / Permission |
|---|---|---|---|
| `GET` | `/api/v1/staff` | List active and suspended staff members with user profiles and branch assignments. | `owner`, `admin`, `manager` |
| `GET` | `/api/v1/staff/:id` | Detailed single staff member record. | `owner`, `admin`, `manager` |
| `GET` | `/api/v1/staff/:id/permissions` | Detailed RBAC permissions held by the member. | `owner`, `admin`, `manager` |
| `GET` | `/api/v1/staff/:id/branches` | Branches assigned to the staff member. | `owner`, `admin`, `manager` |
| `POST` | `/api/v1/staff/invitations` | Issues secure invitation token with predefined role & branch scoping. | `manage_staff` (`owner`/`admin`) |
| `GET` | `/api/v1/staff/invitations` | Lists all pending unaccepted invitations for the business. | `manage_staff` (`owner`/`admin`) |
| `POST` | `/api/v1/staff/invitations/:id/revoke` | Revokes a pending invitation token. | `manage_staff` (`owner`/`admin`) |
| `POST` | `/api/v1/staff/invitations/accept` | Accepts onboarding invitation and creates business membership. | Authenticated user |
| `PATCH` | `/api/v1/staff/:id/role` | Updates member role with privilege escalation & owner retention checks. | `manage_staff` |
| `PUT` | `/api/v1/staff/:id/branches` | Updates branch access mapping in `member_branches`. | `manage_staff` |
| `POST` | `/api/v1/staff/:id/suspend` | Suspends active member (`is_active = 0`); blocks self-suspension and owner lockout. | `manage_staff` |
| `POST` | `/api/v1/staff/:id/reactivate` | Reactivates suspended member (`is_active = 1`). | `manage_staff` |

---

## 4. Frontend User Interface (`src/features/staff/`)

1. **StaffPage (`src/features/staff/pages/StaffPage.tsx`)**:
   - Executive Staff KPIs: Total Staff, Active Staff, Suspended Members, and Pending Onboarding Invites.
   - Filter toolbar (`StaffFilters.tsx`): Search (name, email, phone), Role dropdown, Status filter (`All`, `Active`, `Suspended`).
   - Team Members Table (`StaffTable.tsx`):
     - Staff Name linking to `/staff/:id` (with "You" badge for the active user).
     - Contact details (email, phone).
     - Role Badge with role-specific color accents (`owner`, `admin`, `manager`, `cashier`, `accountant`, `inventory_manager`).
     - Assigned Branches tags or "All Branches".
     - Status Badge (`Active` / `Suspended`) via `StaffStatusBadge.tsx`.
     - Joined Date.
     - Action buttons: "Edit", "Suspend" / "Reactivate".
     - Mobile responsive card list.
   - Pending Invitations Table:
     - Displays recipient email, role, inviter, expiry date.
     - "Copy Link" button with live feedback.
     - "Revoke" button with confirmation prompt.
2. **Staff Details Page (`src/features/staff/pages/StaffDetailsPage.tsx` at `/staff/:id`)**:
   - Comprehensive staff member overview (name, email, phone, role, status, joined date).
   - Branch authorizations breakdown.
   - Interactive Permission Matrix summary (`PermissionSummary.tsx`).
   - Action controls for role updating and status toggling.
3. **Invite Staff Modal (`InviteStaffModal.tsx`)**:
   - Email input, Role dropdown with explanatory capability badge, Branch multiselect checkboxes.
   - Upon submission, surfaces the generated secure invitation link and a one-click copy button.
4. **Edit Staff Modal (`EditStaffModal.tsx`)**:
   - Update member role and modify branch access assignments with instant validation.

---

## 5. Verification Status

- Worker TypeScript build (`npx tsc -p tsconfig.worker.json`): Passed (0 errors).
- Frontend production build (`npm run build`): Passed (0 errors).
- Applied migration: `0014_expenses_and_staff.sql` verified on local D1.

