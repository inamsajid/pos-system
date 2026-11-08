import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { ProductForm } from '../components/ProductForm'
import { ProductToast } from '../components/ProductToast'
import { useProducts } from '../hooks/useProducts'
import { productService } from '../services/productService'
import type { ProductDraft } from '../types/product.types'

export function AddProductPage(){
  const {products}=useProducts()
  const navigate=useNavigate()
  const [saving,setSaving]=useState(false)
  const [notice,setNotice]=useState('')
  const dismissNotice=useCallback(()=>setNotice(''),[])
  const saveProduct=async(draft:ProductDraft,addAnother:boolean)=>{
    setSaving(true)
    try{await productService.createProduct(draft);if(addAnother)setNotice('Product added. You can enter the next one.');else navigate('/products',{state:{notice:'Product created successfully.'}})}catch(saveError){setNotice(saveError instanceof Error?saveError.message:'Unable to save this product.')}finally{setSaving(false)}
  }

  return <>
    <PageHeader title="Add product" description="Add a product to your catalog and set its pricing and stock."/>
    <div className="mx-auto max-w-4xl"><ProductForm products={products} onSubmit={saveProduct} onCancel={()=>navigate('/products')} submitting={saving}/></div>
    <ProductToast message={notice} onClose={dismissNotice}/>
  </>
}
