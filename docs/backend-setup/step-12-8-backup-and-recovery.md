# Step 12.8 Database Backup and Disaster Recovery Preparation

This document defines the disaster recovery, point-in-time restoration, and independent backup protocols for the Northstar POS database (Cloudflare D1) and file storage (Cloudflare R2).

---

## 1. Cloudflare D1 Time Travel Recovery Protocol

Cloudflare D1 includes native continuous point-in-time recovery via **Time Travel**.

### 1.1 Retention Entitlements by Plan
- **Workers Free Plan**: Up to **7 days** of point-in-time history.
- **Workers Paid Plan**: Up to **30 days** of point-in-time history.
- **Confirmation Status**: Pending business owner confirmation of the active Cloudflare subscription plan.

### 1.2 Time Travel Inspection & Restoration Commands

> [!CAUTION]
> A Time Travel restore **overwrites the database in-place**. Always record the current bookmark before executing a restore.

1. **Inspect Current Bookmarks and Historical Window**:
   ```bash
   wrangler d1 time-travel info pos-system-prod-d1 --remote
   ```
2. **Identify Target Timestamp or Bookmark**:
   ```bash
   # Determine the exact UTC timestamp or bookmark ID prior to the incident
   wrangler d1 time-travel info pos-system-prod-d1 --timestamp="2026-11-09T12:00:00Z" --remote
   ```
3. **Execute In-Place Restoration**:
   ```bash
   wrangler d1 time-travel restore pos-system-prod-d1 --bookmark="<TARGET_BOOKMARK_ID>" --remote
   ```
4. **Validation After Restoration**:
   - Query latest known transaction: `SELECT * FROM sales ORDER BY rowid DESC LIMIT 1;`
   - Run relational integrity check: `PRAGMA foreign_key_check;`
   - Test read-only API health endpoint: `GET /api/v1/health`

---

## 2. Independent Database Exports (Long-Term Archive)

Time Travel protects against operational data corruption, but **does not protect against Cloudflare account compromise or accidental database deletion**. Therefore, an independent backup pipeline is established.

### 2.1 Daily SQL Dump Workflow
- Export automated daily SQL dump using Wrangler:
  ```bash
  wrangler d1 export pos-system-prod-d1 --remote --output="./backups/pos-prod-$(date +%Y%m%d).sql"
  ```
- Calculate SHA-256 integrity checksum:
  ```bash
  sha256sum ./backups/pos-prod-*.sql > ./backups/checksums.txt
  ```
- Upload encrypted archive to an independent secondary location (e.g., secondary cloud provider or off-site cold storage).

### 2.2 Retention Policy
- Daily SQL exports: Retained for **90 days**.
- Monthly baseline snapshots: Retained for **7 years** for statutory accounting compliance.

---

## 3. Cloudflare R2 Object Storage Backup

- **Separation of Concerns**: D1 backups capture transaction metadata and file references, but **do not include R2 binary file payloads**.
- **R2 Backup Strategy**:
  - Nightly sync of newly uploaded objects to an off-site S3-compatible cold bucket using `rclone` or S3 lifecycle replication.
  - Orphan Detection: Compare active `files.object_key` rows in D1 against R2 bucket inventory to identify and purge deleted objects.

---

## 4. Recovery Objectives (RPO & RTO)

| Metric | Proposed Target | Operational Trade-off | Sign-Off Status |
| :--- | :--- | :--- | :--- |
| **Recovery Point Objective (RPO)** | **$\le 5$ minutes** via D1 Time Travel; **$\le 24$ hours** via independent SQL dump | Minimal data loss; reliant on Cloudflare platform availability. | **OWNER APPROVAL REQUIRED** |
| **Recovery Time Objective (RTO)** | **$\le 15$ minutes** for Time Travel restore; **$\le 2$ hours** for disaster export reload | Fast operational rollback for operator error; slightly longer for catastrophic failure. | **OWNER APPROVAL REQUIRED** |

---

## 5. Local Restore Rehearsal Evidence

A local backup and restore rehearsal was executed and verified during automated testing:
- **Test Case**: `tests/step12_8_systemAcceptance.test.ts: Part 9.5 Local Database Backup and Restore Rehearsal`
- **Verification**: All 40 relational schemas, foreign key definitions, and business records were dumped and restored into a secondary isolated SQLite instance.
- **Relational Integrity**: `PRAGMA foreign_key_check` executed with **0 errors**.
- **Limitations**: Proves local schema and SQL export fidelity; live remote Time Travel restore rehearsal requires staging environment setup.

