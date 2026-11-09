# POS System — Monetary & Quantity Precision Architecture

## Document Overview
- **Document ID**: `PREC-SPEC-11.7-05`
- **Status**: Draft / Step 11.7 Architecture Finalization
- **Standards**: IEEE 754 Floating-Point Mitigation, Minor Units (Paise) Architecture, Unit-Based Quantity Scaling
- **Audience**: Database Designers, Financial Systems Engineers, Frontend Developers

---

## 1. The Monetary Precision Architecture

### 1.1 The Risk of Floating-Point Arithmetic
In modern JavaScript/TypeScript engines and standard SQLite/D1 `REAL` columns, IEEE 754 double-precision floating-point numbers exhibit well-known representation anomalies:
```javascript
0.1 + 0.2 = 0.30000000000000004
19.99 * 100 = 1998.9999999999998
```
In high-volume POS systems handling thousands of retail tickets daily, floating-point leakage accumulates into reconciliation discrepancies between payment totals, sales tax liabilities, and bank deposits.

### 1.2 The Integer Minor Units Standard (`amountMinor`)
1. **Core Rule**: All monetary values across the database schema, domain models, and API payloads are stored and computed as **64-bit signed integers representing minor currency units (paise)**:
   $$1 \text{ PKR} = 100 \text{ paise}$$
   $$\text{amountMinor} = \text{round}(\text{amountPkr} \times 100)$$
2. **Schema Naming Convention**:
   - Every monetary field in Cloudflare D1 carries the suffix `_minor` or is clearly typed as `amountMinor` (e.g., `unit_price_minor`, `subtotal_minor`, `discount_minor`, `tax_minor`, `total_amount_minor`, `amount_paid_minor`).
3. **Display Layer Conversion**:
   - Conversion to human-readable decimals (`1250` $\rightarrow$ `"Rs 12.50"`) occurs exclusively at the UI boundary using pure formatting functions.
   - The UI never performs balance math using floats.

---

## 2. Rounding Rules & Proportional Allocations

### 2.1 Rounding Mode
- Standard **Half-Up Rounding** (`Math.round`) is used for retail consumer transactions:
  $$\text{round}(x) = \lfloor x + 0.5 \rfloor$$
- For fractional division (such as taxes or currency splits), remainders are explicitly tracked.

### 2.2 Proportional Cart Discount Distribution Algorithm
When a discount is applied at the cart level, it must be distributed across line items so that item-level tax and profit margins can be computed accurately:
1. Let cart line totals be $T_1, T_2, \dots, T_n$ (in minor units).
2. Let cart gross subtotal be $S = \sum_{i=1}^n T_i$.
3. Let total discount be $D_{\text{total}}$ (in minor units).
4. For each item $i$, the preliminary proportional discount is:
   $$D_i = \left\lfloor \frac{T_i \times D_{\text{total}}}{S} \right\rfloor$$
5. Calculate the remainder:
   $$R = D_{\text{total}} - \sum_{i=1}^n D_i$$
6. Distribute the remaining $R$ paise (1 paise each) to the items with the highest remainders or to the highest-value line items until $R = 0$.
7. **Guaranteed Invariant**:
   $$\sum_{i=1}^n D_i \equiv D_{\text{total}}$$
   *(Zero lost or gained pennies).*

---

## 3. Quantity Precision & Unit Classification

### 3.1 Unit Categories
The POS system supports two distinct classes of product units:

| Unit Class | Supported Units | Permitted Precision | Validation Rule |
| :--- | :--- | :--- | :--- |
| **Discrete Units** | `piece`, `box`, `pack`, `dozen` | Whole Integers ($0$ decimal places) | `Number.isInteger(quantity)` |
| **Continuous Units** | `kg`, `liter`, `meter`, `gram` | Up to 3 decimal places (scale 1000) | `Math.round(quantity * 1000) === quantity * 1000` |

### 3.2 Continuous Measurement Handling
1. **Weight / Volume Scaling**:
   - For items sold by weight (`kg`) or volume (`liter`), scales transmit measurements up to grams (e.g. `1.245 kg`).
   - Domain validators reject quantities with more than 3 decimal digits.
2. **Gram vs Kilogram Strategy**:
   - Recommended practice: Maintain products in standard base units (`kg` or `gram`) with clear unit labels.
   - Line Total formula:
     $$\text{Line Total Minor} = \text{round}\left(Q \times \text{unitPriceMinor}\right)$$

