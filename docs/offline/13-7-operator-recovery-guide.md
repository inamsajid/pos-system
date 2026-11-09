# Step 13.7 — Store Manager & Operator Recovery Guide

## 1. Quick Reference: Outbox Status Icons

When managing POS terminals, look for the synchronization status badge in the POS header or Shift Management drawer:

| Badge / Icon | Status | Action Required |
|---|---|---|
| 🟢 **Synced** | All sales acknowledged | None. System is completely synchronized with central D1. |
| 🟡 **Pending Sync (N)** | $N$ sales in local queue | Wait for reconnection or click "Sync Now" if online. |
| 🔵 **Syncing...** | Commands in flight | Background sync in progress; do not turn off terminal. |
| 🟠 **Reconciliation Required** | Blocked business exception | **Manager action required**. Open Reconciliation Console. |
| 🔴 **Blocked Auth / Error** | Session expired | Log out and log back in to refresh credentials. |

---

## 2. Resolving "Reconciliation Required" Transactions

### Step 1: Open the Manager Outbox Console
1. Navigate to **Settings > Offline Sync > Pending Transactions**.
2. Locate items highlighted in orange (`reconciliation_required`).

### Step 2: Review Transaction Details
- Check the **Provisional Receipt Number** (e.g. `OFF-01-0021`).
- Match it with the cashier's physical paper receipt duplicate from the cash drawer.
- Note the error reason (e.g., `Allocation quota exceeded for SKU TEA-01`).

### Step 3: Approve and Retry
1. If the store inventory actually has the physical items and the allocation simply lapsed, add an approval note: `"Stock verified physically in store."`
2. Click **"Retry Reconciliation"**.
3. The command returns to `pending` and immediately dispatches to the server.
4. Verify the status updates to 🟢 **"Acknowledged"**.

---

## 3. Handling Device Loss or Theft

If a terminal tablet is lost, stolen, or broken:
1. Immediately log into the Cloudflare Worker admin or desktop POS manager.
2. Go to **Settings > Devices > Terminals**.
3. Select the lost terminal and click **"Revoke & Reconcile Lost Device"**.
4. All unconsumed stock quotas are instantly returned to the main branch inventory.
5. The device's cryptographic authorizations are marked `revoked` centrally. Even if an unauthorized party boots the device, no transactions will be accepted.

