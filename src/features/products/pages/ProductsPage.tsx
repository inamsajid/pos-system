import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Plus, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { Modal } from '../../../components/ui/Modal'
import { PageHeader } from '../../../components/common/PageHeader'
import { ProductFilters, type ProductFiltersValue } from '../components/ProductFilters'
import { ProductSearch } from '../components/ProductSearch'
import { ProductStats } from '../components/ProductStats'
import { ProductTable } from '../components/ProductTable'
import { ProductToast } from '../components/ProductToast'
import { StockAdjustmentModal } from '../components/StockAdjustmentModal'
import { productCategories as defaultCategories } from '../data/productMockData'
import { useProducts } from '../hooks/useProducts'
import { productService } from '../services/productService'
import { categoryService } from '../../categories/services/categoryService'
import type { Product, StockAdjustmentInput, ProductSort, ProductCategory } from '../types/product.types'
import { getProductStockStatus } from '../utils/productUtils'

const initialFilters: ProductFiltersValue = { categoryId: '', status: '', stockStatus: '', minPrice: '', maxPrice: '' }
const pageSizes = [10, 25, 50]

function downloadProducts(products: Product[], categories: ProductCategory[]) {
  const headers = ['Name','SKU','Barcode','Category','Purchase price (PKR)','Selling price (PKR)','Stock quantity','Unit','Stock status','Product status']
  const rows = products.map((product) => [product.name,product.sku,product.barcode??'',categories.find((category)=>category.id===product.categoryId)?.name??'Uncategorized',String(product.purchasePrice),String(product.sellingPrice),product.trackInventory?String(product.stockQuantity):'Not tracked',product.unit,getProductStockStatus(product),product.status])
  const csv=[headers,...rows].map((row)=>row.map((value)=>`"${value.replaceAll('"','""')}"`).join(',')).join('\r\n')
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  const anchor=document.createElement('a');anchor.href=url;anchor.download='pos-products.csv';anchor.click()
  window.setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export function ProductsPage(){
  const {products,loading,error,reload}=useProducts()
  const location=useLocation()
  const navigate=useNavigate()
  const [searchParams] = useSearchParams()
  const urlCategory = searchParams.get('categoryId') || ''

  const [categories, setCategories] = useState<ProductCategory[]>(defaultCategories)
  const [search,setSearch]=useState('')
  const [filters,setFilters]=useState<ProductFiltersValue>(() => ({
    ...initialFilters,
    categoryId: urlCategory,
  }))
  const [sort,setSort]=useState<ProductSort>('name-asc')
  const [page,setPage]=useState(1)
  const [pageSize,setPageSize]=useState(10)
  const [adjustProduct,setAdjustProduct]=useState<Product>()
  const [archiveProduct,setArchiveProduct]=useState<Product>()
  const [toast,setToast]=useState('')

  useEffect(() => {
    categoryService.getCategories().then((cats) => {
      setCategories(cats.map((c) => ({ id: c.id, name: c.name })))
    })
  }, [])

  const [prevUrlCategory, setPrevUrlCategory] = useState(urlCategory)
  if (prevUrlCategory !== urlCategory) {
    setPrevUrlCategory(urlCategory)
    if (urlCategory) {
      setFilters((prev) => ({ ...prev, categoryId: urlCategory }))
    }
  }

  const routeNotice=location.state&&typeof location.state==='object'&&'notice' in location.state&&typeof location.state.notice==='string'?location.state.notice:''
  const dismissToast=useCallback(()=>{setToast('');if(routeNotice)navigate(location.pathname,{replace:true,state:null})},[location.pathname,navigate,routeNotice])
  const toastMessage=toast||routeNotice

  const hasFilters=Boolean(search||filters.categoryId||filters.status||filters.stockStatus||filters.minPrice||filters.maxPrice)
  const filteredProducts=useMemo(()=>{
    const query=search.trim().toLocaleLowerCase()
    const filtered=products.filter((product)=>{
      if(query&&!`${product.name} ${product.sku} ${product.barcode??''}`.toLocaleLowerCase().includes(query))return false
      if(filters.categoryId&&product.categoryId!==filters.categoryId)return false
      if(filters.status&&product.status!==filters.status)return false
      if(filters.stockStatus&&getProductStockStatus(product)!==filters.stockStatus)return false
      const min=filters.minPrice===''?undefined:Number(filters.minPrice)
      const max=filters.maxPrice===''?undefined:Number(filters.maxPrice)
      if(min!==undefined&&Number.isFinite(min)&&product.sellingPrice<min)return false
      if(max!==undefined&&Number.isFinite(max)&&product.sellingPrice>max)return false
      return true
    })
    return filtered.sort((first,second)=>{
      if(sort==='name-asc')return first.name.localeCompare(second.name)
      if(sort==='name-desc')return second.name.localeCompare(first.name)
      if(sort==='price-asc')return first.sellingPrice-second.sellingPrice
      if(sort==='price-desc')return second.sellingPrice-first.sellingPrice
      if(sort==='stock-asc')return first.stockQuantity-second.stockQuantity
      return second.stockQuantity-first.stockQuantity
    })
  },[filters,products,search,sort])
  const pageCount=Math.max(1,Math.ceil(filteredProducts.length/pageSize))
  const currentPage=Math.min(page,pageCount)
  const pageProducts=filteredProducts.slice((currentPage-1)*pageSize,currentPage*pageSize)

  const clearFilters=()=>{setSearch('');setFilters(initialFilters);setPage(1)}
  const changeSearch=(value:string)=>{setSearch(value);setPage(1)}
  const changeFilters=(value:ProductFiltersValue)=>{setFilters(value);setPage(1)}

  const confirmArchive=async()=>{
    if(!archiveProduct)return
    try{await productService.archiveProduct(archiveProduct.id);await reload();setToast(`${archiveProduct.name} was archived.`);setArchiveProduct(undefined)}catch(archiveError){setToast(archiveError instanceof Error?archiveError.message:'Unable to archive product.')}
  }
  const restoreProduct=async(product:Product)=>{try{await productService.restoreProduct(product.id);await reload();setToast(`${product.name} was restored.`)}catch(restoreError){setToast(restoreError instanceof Error?restoreError.message:'Unable to restore product.')}}
  const adjustStock=async(adjustment:StockAdjustmentInput)=>{
    if(!adjustProduct)return
    await productService.adjustProductStock(adjustProduct.id,adjustment)
    await reload()
    setToast('Stock adjustment saved for this demo session.')
    setAdjustProduct(undefined)
  }

  return <>
    <PageHeader title="Products" description="Manage your products, prices and inventory." action={<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row"><Button onClick={()=>downloadProducts(filteredProducts, categories)}><Download size={15}/>Export products</Button><Link to="/products/new" className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"><Plus size={16}/>Add product</Link></div>}/>
    <ProductStats products={products}/>
    <Card className="mb-5 p-4 sm:p-5"><div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end"><ProductSearch value={search} onChange={changeSearch}/><label className="block w-full text-xs font-semibold text-slate-700 md:w-48">Sort by<select value={sort} onChange={(event)=>{setSort(event.target.value as ProductSort);setPage(1)}} className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal text-slate-700 outline-none focus:border-blue-500"><option value="name-asc">Name: A to Z</option><option value="name-desc">Name: Z to A</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="stock-asc">Stock: low to high</option><option value="stock-desc">Stock: high to low</option></select></label></div><ProductFilters categories={categories} value={filters} onChange={changeFilters} onClear={clearFilters} hasFilters={hasFilters}/></Card>

    <Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:px-5"><div><h2 className="text-sm font-bold text-slate-800">Product catalog</h2><p className="mt-1 text-xs text-slate-400">{filteredProducts.length} {filteredProducts.length===1?'product':'products'} found{hasFilters?' · filtered':''}</p></div>{hasFilters&&<button onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600">Clear filters <X size={13}/></button>}</div>
      {loading?<div role="status" className="grid min-h-56 place-items-center text-sm text-slate-500"><span className="flex items-center gap-2"><span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"/>Loading products…</span></div>:error?<div role="alert" className="p-8 text-center text-sm text-rose-600">{error}</div>:<ProductTable products={pageProducts} categories={categories} onAdjust={setAdjustProduct} onArchive={setArchiveProduct} onRestore={restoreProduct}/>}
      {!loading&&!error&&filteredProducts.length>0&&<div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"><p className="text-xs text-slate-500">Showing {(currentPage-1)*pageSize+1}–{Math.min(currentPage*pageSize,filteredProducts.length)} of {filteredProducts.length}</p><div className="flex flex-wrap items-center gap-2"><label className="mr-1 text-xs text-slate-500">Rows<select aria-label="Page size" value={pageSize} onChange={(event)=>{setPageSize(Number(event.target.value));setPage(1)}} className="ml-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700">{pageSizes.map((size)=><option key={size} value={size}>{size}</option>)}</select></label><Button disabled={currentPage<=1} onClick={()=>setPage((current)=>Math.max(1,current-1))}>Previous</Button><span aria-live="polite" className="min-w-16 text-center text-xs text-slate-500">{currentPage} / {pageCount}</span><Button disabled={currentPage>=pageCount} onClick={()=>setPage((current)=>Math.min(pageCount,current+1))}>Next</Button></div></div>}
    </Card>

    <Modal open={Boolean(archiveProduct)} onClose={()=>setArchiveProduct(undefined)} title="Archive product?">{archiveProduct&&<div><p className="text-sm leading-6 text-slate-600">Archive <strong className="text-slate-800">{archiveProduct.name}</strong>? It will no longer be available for new sales, and its details will remain available for historical records. You can restore it later.</p><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button onClick={()=>setArchiveProduct(undefined)}>Cancel</Button><Button variant="primary" className="bg-rose-600 hover:bg-rose-700" onClick={()=>void confirmArchive()}>Archive product</Button></div></div>}</Modal>
    <StockAdjustmentModal key={`${adjustProduct?.id??'none'}-${Boolean(adjustProduct)}`} product={adjustProduct} open={Boolean(adjustProduct)} onClose={()=>setAdjustProduct(undefined)} onApply={adjustStock}/>
    <ProductToast message={toastMessage} onClose={dismissToast}/>
  </>
}
