# Step 13.5 — Device Registration and Identity Specification

## 1. Device Registration Model

Every client terminal possesses a stable installation identifier (`dev_<UUID>`) generated on first initialization in Step 13.2. To participate in synchronization, the device must be registered on the server within an authenticated business session.

```sql
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked')) DEFAULT 'active',
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, user_id, installation_id)
);
```

---

## 2. Security Boundaries & Invariants

1. **Device Identity is NOT an Authorization Principal**:
   - Possessing an `installation_id` grants zero access.
   - Every sync request must carry a valid session cookie and `X-Business-Id` header.
2. **Revocation Enforcement**:
   - If a device is revoked (`status: 'revoked'`), subsequent sync requests return `403 Forbidden` (`DEVICE_REVOKED`).
   - Revocation takes effect immediately on the next request.
3. **Multi-User / Multi-Tenant Support**:
   - One physical device may be used by different cashiers across shifts.
   - The unique constraint `(business_id, user_id, installation_id)` allows distinct user-device pairs to be audited independently.
4. **RBAC Controls**:
   - `owner` and `admin` roles can view and revoke any registered device in their business.
   - Other roles (`cashier`, `manager`) can only inspect their own device registrations.

---

## 3. Endpoints

- `POST /api/v1/sync/devices/register`
- `GET /api/v1/sync/devices`
- `POST /api/v1/sync/devices/heartbeat`
- `POST /api/v1/sync/devices/:id/revoke`

