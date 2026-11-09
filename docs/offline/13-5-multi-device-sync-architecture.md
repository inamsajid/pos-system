# Step 13.5 — Multi-Device Synchronization Architecture

## 1. System Topology & Responsibilities

The Northstar POS multi-device synchronization protocol enables changes committed by one authorized terminal or browser tab to propagate to all other authorized devices in the merchant's business without leaking cross-tenant or cross-branch data.

```mermaid
flowchart TD
    subgraph Device_A["Device A (Cash Register 1)"]
        UI_A["POS React UI / Forms"]
        Dexie_A["Dexie.js IndexedDB Cache"]
        Sync_A["Sync Pull Engine & Local Cursor"]
    end

    subgraph Cloudflare["Cloudflare Infrastructure"]
        Worker["Cloudflare Worker Sync API"]
        D1[("Cloudflare D1 Central Database")]
        ChangeLog[("sync_change_log (D1)")]
    end

    subgraph Device_B["Device B (Cash Register 2)"]
        Sync_B["Sync Pull Engine & Local Cursor"]
        Dexie_B["Dexie.js IndexedDB Cache"]
        UI_B["POS React UI / Forms"]
    end

    UI_A -->|"1. Online Mutation (Price update, Version v4)"| Worker
    Worker -->|"2. Atomic Batch Write"| D1
    Worker -->|"3. Commit Event (Version v5, seq 104)"| ChangeLog
    Worker -->|"4. Success (v5)"| UI_A
    Dexie_A -->|"5. Update local cache (v5)"| Dexie_A

    Sync_B -->|"6. Incremental Pull (after seq 103)"| Worker
    Worker -->|"7. Read ChangeLog & Filter Branch Access"| ChangeLog
    Worker -->|"8. Return changes (seq 104, safe DTO)"| Sync_B
    Sync_B -->|"9. Atomic write to Dexie & advance cursor"| Dexie_B
    Dexie_B -->|"10. TanStack Query cache refresh"| UI_B
```

---

## 2. Core Architectural Invariants

1. **Single Source of Truth**: Cloudflare D1 is the sole authoritative state holder. Local IndexedDB is an authorized, device-local read replica.
2. **Anti-Last-Write-Wins (Anti-LWW)**: No client can blindly overwrite server data. Version conflicts return `409 Conflict` requiring user review.
3. **No Financial Mutations Offline**: Offline checkout, payments, purchases, and manual stock movements remain strictly disabled (deferred to Step 13.6).
4. **Scope-Bound Cursors**: Cursors are bound to `[userId + businessId + branchId + stream]`. A cursor from Business A or Branch 1 cannot pull data from Business B or Branch 2.
5. **No Long-Running Transactions Across Network**: Network requests never hold open IndexedDB transactions. Responses are fully downloaded, verified, and applied in a micro-transaction.
6. **Wholesale Margin Privacy**: The synchronization feed strips all wholesale purchase prices before sending data to client devices.

