# Northstar POS — Offline Operation & Catalog Caching User Guide

This guide explains how offline mode works for cashiers, managers, and administrators in the Northstar POS application.

---

## 1. What Happens When Network Drops?

### 1.1 Automatic Detection
The POS application continuously monitors device connectivity. If internet or local Wi-Fi connectivity is lost:
1. An amber **Offline Status Banner** automatically appears across the top of the screen:
   > ⚠️ **Offline Mode Active.** Showing cached catalog data (last synced: [date/time]). Catalog updates and POS checkout are restricted until connection is restored.
2. The header pill updates from green **Online** to amber **Offline**.

### 1.2 Reading Catalog Data While Offline
- Cashiers can browse products, categories, SKU numbers, barcodes, and selling prices.
- Search by name, SKU, or barcode remains fast and responsive using local IndexedDB indexing.
- Products display a notice indicating:
  > *"Last known stock — synchronized at [date/time]. Informational only."*

### 1.3 What Is Disabled Offline (Invariants)
To protect financial accuracy and prevent multi-device overselling:
- **POS Checkout & Sales**: Disabled until connected.
- **Product & Category Edits**: Adding new products, editing prices, archiving, or restoring is disabled.
- **Stock Adjustments & Counts**: Cannot be submitted offline.
- **Supplier & Customer Payments**: Disabled offline.

---

## 2. Security & Merchant Privacy

- **Wholesale Margins Are Protected**: Wholesale purchase prices (`purchasePrice`) are strictly excluded from client-side offline storage. Cashiers inspecting browser storage or network logs cannot view merchant wholesale purchase costs.
- **Multi-Tenant Separation**: If multiple users or branches share a single computer, local cache records are strictly isolated by `[userId + businessId + branchId]`. Signing out securely clears the local tenant cache.

---

## 3. Restoring Connectivity & Syncing

1. When the internet connection returns, the system automatically detects network recovery and initiates a background catalog synchronization.
2. The header indicator displays **Syncing...** with a spinner while fresh data is retrieved from Cloudflare D1.
3. Once complete, the indicator turns to green **Online** with an updated sync timestamp.
4. Users can also manually trigger a synchronization at any time by clicking the **Online** pill in the top header.

