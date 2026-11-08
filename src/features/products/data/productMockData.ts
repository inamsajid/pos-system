import type { Product, ProductCategory } from '../types/product.types'

export const productCategories: ProductCategory[] = [
  { id: 'electronics', name: 'Electronics' },
  { id: 'accessories', name: 'Accessories' },
  { id: 'grocery', name: 'Grocery' },
  { id: 'clothing', name: 'Clothing' },
  { id: 'home-kitchen', name: 'Home & Kitchen' },
  { id: 'stationery', name: 'Stationery' },
]

const createdAt = '2026-10-15T10:00:00.000Z'

export const productMockData: Product[] = [
  { id: 'prd-1001', name: 'Wireless Mouse', sku: 'ELC-1001', barcode: '8901000000011', description: 'Compact wireless mouse with adjustable DPI.', categoryId: 'electronics', unit: 'piece', purchasePrice: 1450, sellingPrice: 2199, stockQuantity: 28, lowStockThreshold: 8, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1002', name: 'USB-C Cable 1m', sku: 'ACC-1002', barcode: '8901000000028', description: 'Braided USB-C charging and data cable.', categoryId: 'accessories', unit: 'piece', purchasePrice: 280, sellingPrice: 499, stockQuantity: 6, lowStockThreshold: 10, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1003', name: 'Basmati Rice 5kg', sku: 'GRC-1003', barcode: '8901000000035', description: 'Premium long-grain basmati rice.', categoryId: 'grocery', unit: 'pack', purchasePrice: 1620, sellingPrice: 1890, stockQuantity: 42, lowStockThreshold: 12, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1004', name: 'Cotton T-Shirt', sku: 'CLT-1004', barcode: '8901000000042', description: 'Everyday cotton crew-neck t-shirt.', categoryId: 'clothing', unit: 'piece', purchasePrice: 850, sellingPrice: 1299, stockQuantity: 15, lowStockThreshold: 5, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1005', name: 'Stainless Steel Bottle', sku: 'HOM-1005', barcode: '8901000000059', description: 'Insulated 750ml reusable bottle.', categoryId: 'home-kitchen', unit: 'piece', purchasePrice: 1180, sellingPrice: 1750, stockQuantity: 0, lowStockThreshold: 6, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1006', name: 'A4 Notebook', sku: 'STA-1006', barcode: '8901000000066', description: 'Hard-cover ruled notebook, 200 pages.', categoryId: 'stationery', unit: 'piece', purchasePrice: 190, sellingPrice: 320, stockQuantity: 64, lowStockThreshold: 15, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1007', name: 'Bluetooth Earbuds', sku: 'ELC-1007', barcode: '8901000000073', description: 'Wireless earbuds with charging case.', categoryId: 'electronics', unit: 'piece', purchasePrice: 3400, sellingPrice: 4990, stockQuantity: 11, lowStockThreshold: 4, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1008', name: 'Olive Oil 500ml', sku: 'GRC-1008', barcode: '8901000000080', description: 'Cold-pressed extra virgin olive oil.', categoryId: 'grocery', unit: 'liter', purchasePrice: 990, sellingPrice: 1250, stockQuantity: 19, lowStockThreshold: 7, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1009', name: 'Leather Wallet', sku: 'ACC-1009', barcode: '8901000000097', description: 'Slim bifold wallet with card slots.', categoryId: 'accessories', unit: 'piece', purchasePrice: 1350, sellingPrice: 1990, stockQuantity: 8, lowStockThreshold: 5, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1010', name: 'Ceramic Dinner Set', sku: 'HOM-1010', description: 'Six-piece glazed ceramic dinner set.', categoryId: 'home-kitchen', unit: 'box', purchasePrice: 2800, sellingPrice: 3690, stockQuantity: 7, lowStockThreshold: 3, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1011', name: 'Gel Pen Pack', sku: 'STA-1011', barcode: '8901000000110', description: 'Pack of five smooth-writing gel pens.', categoryId: 'stationery', unit: 'pack', purchasePrice: 210, sellingPrice: 350, stockQuantity: 32, lowStockThreshold: 10, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1012', name: 'Denim Jeans', sku: 'CLT-1012', barcode: '8901000000127', description: 'Straight-fit denim jeans.', categoryId: 'clothing', unit: 'piece', purchasePrice: 2200, sellingPrice: 3290, stockQuantity: 5, lowStockThreshold: 5, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1013', name: 'Desk Lamp', sku: 'HOM-1013', barcode: '8901000000134', description: 'LED desk lamp with adjustable neck.', categoryId: 'home-kitchen', unit: 'piece', purchasePrice: 1250, sellingPrice: 1850, stockQuantity: 14, lowStockThreshold: 5, status: 'archived', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1014', name: 'Black Tea 250g', sku: 'GRC-1014', barcode: '8901000000141', description: 'Loose leaf black tea blend.', categoryId: 'grocery', unit: 'pack', purchasePrice: 390, sellingPrice: 560, stockQuantity: 0, lowStockThreshold: 8, status: 'active', trackInventory: true, createdAt, updatedAt: createdAt },
  { id: 'prd-1015', name: 'Gift Wrapping Paper', sku: 'STA-1015', description: 'Seasonal wrapping paper sold by the roll.', categoryId: 'stationery', unit: 'meter', purchasePrice: 80, sellingPrice: 150, stockQuantity: 0, lowStockThreshold: 0, status: 'active', trackInventory: false, createdAt, updatedAt: createdAt },
]
