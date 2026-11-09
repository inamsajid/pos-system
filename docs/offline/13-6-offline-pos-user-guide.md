# Step 13.6 — Offline POS Cashier & Manager Guide

## 1. What Happens When Network Drops?

When internet connectivity is lost:
1. The POS header indicator transitions to **"Offline Mode"** (Amber badge).
2. The system checks if an active offline authorization package exists for your terminal.
3. If active, you can continue scanning allocated items and tendering cash payments without interruption.

---

## 2. Cashier Instructions During Offline Operation

### Permitted Actions
- **Scan / Select Products**: Items allocated in your terminal quota can be added to the cart.
- **Adjust Quantities**: You can adjust quantities up to the allocated quota remaining for your device.
- **Cash Checkout**: Accept cash tender, enter tendered amount, and dispense exact change.
- **Print Provisional Receipts**: Hand the customer their receipt marked `"PENDING SYNCHRONIZATION"`.

### Prohibited Actions (Disabled in UI)
- **Credit / Account Sales**: "Add to Customer Ledger" is disabled.
- **Card / QR Payments**: Digital payment methods are grayed out.
- **Manual Price Overrides**: Prices cannot be typed or modified.
- **Discounts**: Discount input is locked.
- **Customer Creation**: Adding new customers requires online connectivity.

---

## 3. Shift End & What to Do When Online Returns

1. As soon as connectivity is restored, the POS terminal automatically detects the server health probe.
2. The background outbox dispatches all pending offline sales to the server.
3. Once all transactions are marked **"Acknowledged"**, your provisional sales are officially registered as legal invoices in the central system.
4. If any transaction displays an amber warning icon (**"Reconciliation Required"**), notify your store manager immediately.

