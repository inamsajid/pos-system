# POS System — Inventory Valuation & Costing Policy

## Document Overview
- **Document ID**: `INV-SPEC-11.7-04`
- **Status**: Draft / Step 11.7 Architecture Finalization
- **Methodology**: Perpetual Moving Weighted Average Cost (MWA)
- **Standard**: IAS 2 / GAAP Compliant Inventory Valuation for Retail
- **Audience**: Inventory Controllers, Financial Analysts, Backend Engineers

---

## 1. Selected Valuation Method: Perpetual Moving Weighted Average (MWA)

### 1.1 Architectural Rationale
For small-to-medium retail enterprises (grocery, FMCG, electronics, apparel), **Perpetual Moving Weighted Average (MWA)** is the industry-standard valuation method because:
1. **Algorithmic Simplicity & Performance**: Does not require maintaining complex, fragmented FIFO/LIFO queues across distributed POS terminals and Cloudflare D1 tables.
2. **Realistic Gross Margins**: Smooths out price volatility from suppliers without artificial margin spikes.
3. **Continuous Accuracy**: Updates instantly upon every goods receipt.

### 1.2 Mathematical Formulation
Whenever new physical inventory is received via a confirmed `GoodsReceipt`:

$$\bar{C}_{\text{new}} = \frac{(Q_{\text{current}} \times \bar{C}_{\text{current}}) + (Q_{\text{received}} \times C_{\text{invoice}})}{Q_{\text{current}} + Q_{\text{received}}}$$

Where:
- $Q_{\text{current}}$ = Pre-receipt sellable quantity on hand.
- $\bar{C}_{\text{current}}$ = Current moving average unit cost (in integer paise).
- $Q_{\text{received}}$ = Newly received quantity.
- $C_{\text{invoice}}$ = Net purchase cost per unit from the supplier invoice (after line discounts and freight proration).
- $\bar{C}_{\text{new}}$ = Updated moving average unit cost.

### 1.3 Edge Cases & Boundary Conditions
1. **Zero or Negative Stock on Hand ($Q_{\text{current}} \le 0$)**:
   - If stock was zero or temporarily negative due to unentered stock receiving:
     $$\bar{C}_{\text{new}} = C_{\text{invoice}}$$
   - The new purchase cost becomes the definitive baseline moving cost.
2. **Total Combined Quantity Zero or Negative ($Q_{\text{current}} + Q_{\text{received}} \le 0$)**:
   - Preserves the existing $\bar{C}_{\text{current}}$ to prevent division by zero or negative cost anomalies.
3. **Cost Rounding**:
   - $\bar{C}_{\text{new}}$ is rounded to integer paise (or 4 decimal places for unit cost before multiplying by total quantity, stored as integer minor units).

---

## 2. Cost of Goods Sold (COGS) Locking at Checkout

### 2.1 The Principle of Cost Immutability
When a customer purchases items at the POS register:
1. The line item captures and permanently locks the **snapshot unit cost** at the moment of sale:
   $$\text{COGS}_{\text{item}} = Q_{\text{sold}} \times \bar{C}_{\text{current}}$$
2. **No Retroactive Alteration**:
   - Future supplier purchases with higher or lower purchase prices **NEVER** alter the recorded COGS of past sales.
   - Historical profit and loss statements remain 100% stable and audit-proof.

### 2.2 Gross Profit Formula
For any completed sale or line item:
$$\text{Gross Revenue} = \text{Selling Price} \times Q_{\text{sold}} - \text{Discount}$$
$$\text{COGS} = \bar{C}_{\text{snapshot}} \times Q_{\text{sold}}$$
$$\text{Gross Profit} = \text{Gross Revenue} - \text{COGS}$$
$$\text{Gross Margin \%} = \left(\frac{\text{Gross Profit}}{\text{Gross Revenue}}\right) \times 100$$

---

## 3. Handling Historical & Demo Data

### 3.1 The Historical Data Challenge
In the existing frontend prototype, products have a static `purchasePrice` in `productMockData.ts`, and sales did not store individual unit cost snapshots at transaction time.

### 3.2 Transition & Migration Strategy
1. **Baseline Unit Cost Initialization**:
   - Upon moving to the canonical domain model, each product's current `purchasePrice` is used as the initial $\bar{C}_{\text{current}}$.
2. **Historical COGS Flagging**:
   - For all sales created prior to the deployment of Step 11.7 / D1 backend:
     - If snapshot cost is missing, compute COGS using the product's baseline `purchasePrice`.
     - Flag the sale item record with `cogsEstimated: true`.
   - Reports and analytics will display a footnote indicating that historical margins prior to the formal inventory engine are estimated.

---

## 4. Inventory Adjustments & Stock Counts

### 4.1 Stock Adjustments
| Movement Type | Cost Basis | Ledger Impact |
| :--- | :--- | :--- |
| **`adjustment_in` (Found stock / gift)** | Uses current $\bar{C}_{\text{current}}$ (or entered cost if donor known) | Cr: Inventory Asset<br>Dr: Inventory Gain / Other Income |
| **`adjustment_out` (Damaged / expired)** | Uses current $\bar{C}_{\text{current}}$ | Cr: Inventory Asset<br>Dr: Inventory Shrinkage Expense |
| **`stock_count_adjustment`** | Uses current $\bar{C}_{\text{current}}$ | Net difference to Inventory Shrinkage/Gain |

### 4.2 Stock Count Confirmation Protocol
1. During a physical stock count, staff count physical quantities $Q_{\text{physical}}$.
2. System calculates variance: $\Delta Q = Q_{\text{physical}} - Q_{\text{system}}$.
3. When confirmed by manager:
   - System atomically generates an offsetting `stock_count_adjustment` movement with $\text{quantityChange} = \Delta Q$.
   - The moving average unit cost $\bar{C}$ remains unchanged.
   - The inventory valuation change $\Delta V = \Delta Q \times \bar{C}$ is posted to the shrinkage ledger.

