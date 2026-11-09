# Step 13.7 — Stock Allocation Reconciliation Protocol

## 1. Purpose of Allocation Reconciliation

When offline authorizations expire, shifts end, or POS terminals are decommissioned, any reserved but unconsumed stock quotas must be returned to the general sellable inventory pool without affecting committed sales.

---

## 2. Server Reconciliation API (`POST /api/v1/offline/allocations/reconcile`)

### 2.1 Request Payload
```json
{
  "allocationId": "alloc_tea_001",
  "reason": "shift_ended"
}
```

### 2.2 Server Actions
1. Verifies the allocation belongs to the authenticated business and branch.
2. Reads `allocated_quantity` and `consumed_quantity`.
3. Sets `status = 'reconciled'`.
4. Writes an audit entry into `stock_movements` noting that `allocated_quantity - consumed_quantity` unconsumed quota was released.
5. Emits a stock change event to `sync_change_log` so other terminals immediately see the restored sellable balance.

---

## 3. Handling Lost or Damaged Terminals (`POST /api/v1/offline/devices/reconcile-lost`)

If a POS tablet is stolen, dropped, or destroyed while holding active stock allocations:
1. Store Manager invokes `POST /api/v1/offline/devices/reconcile-lost` with the `deviceId`.
2. The server revokes the device in table `devices` (`status = 'revoked'`).
3. The server revokes all active authorizations issued to that device (`status = 'revoked'`).
4. Any unconsumed quotas on that device are marked `revoked` and returned to the sellable stock pool.
5. Even if the stolen tablet is later booted and tries to commit sales, the server rejects them with `403 FORBIDDEN` because the device is revoked.

