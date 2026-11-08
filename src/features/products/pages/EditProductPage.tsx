import { useCallback, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { EmptyState } from '../../../components/feedback/EmptyState'
import { PageHeader } from '../../../components/common/PageHeader'
import { ProductForm } from '../components/ProductForm'
import { ProductToast } from '../components/ProductToast'
import { useProducts } from '../hooks/useProducts'
import { productService } from '../services/productService'
import type { ProductDraft } from '../types/product.types'

export function EditProductPage(){
  const {productId}=useParams()
  const {products,loading}=useProducts()
  const product=products.find((entry)=>entry.id===productId)
  const navigate=useNavigate()
  const [saving,setSaving]=useState(false)
  const [notice,setNotice]=useState('')
  const dismissNotice=useCallback(()=>setNotice(''),[])
  const saveProduct=async(draft:ProductDraft)=>{
    if(!product)return
    setSaving(true)
    try{await productService.updateProduct(product.id,draft);navigate(`/products/${product.id}`,{state:{notice:'Product updated successfully.'}})}catch(saveError){setNotice(saveError instanceof Error?saveError.message:'Unable to update this product.')}finally{setSaving(false)}
  }

  if(loading)return <div role="status" className="grid min-h-56 place-items-center text-sm text-slate-500">Loading product…</div>
  if(!product)return <><PageHeader title="Product not found" description="This product may have been removed from the current demo data." action={<Link to="/products"><Button><ArrowLeft size={15}/>Back to products</Button></Link>}/><EmptyState title="We couldn't find that product" description="Check the product link or return to the catalog."/></>
  return <><PageHeader title="Edit product" description={`Update the details for ${product.name}.`}/><div className="mx-auto max-w-4xl"><ProductForm key={product.id} product={product} products={products} onSubmit={saveProduct} onCancel={()=>navigate(`/products/${product.id}`)} submitting={saving}/></div><ProductToast message={notice} onClose={dismissNotice}/></>
}
