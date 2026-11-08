import { useEffect,useState } from 'react'
import { Link,useNavigate,useParams } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { SupplierForm } from '../components/SupplierForm'
import { supplierService } from '../services/supplierService'
import type { Supplier,SupplierDraft } from '../types/supplier.types'
export function EditSupplierPage(){const{supplierId:id}=useParams();const nav=useNavigate();const[supplier,setSupplier]=useState<Supplier>();const[loading,setLoading]=useState(true);const[saving,setSaving]=useState(false);useEffect(()=>{void supplierService.getSupplierById(id??'').then(setSupplier).finally(()=>setLoading(false))},[id]);if(loading)return <p role="status" className="p-8">Loading supplier…</p>;if(!supplier)return <><PageHeader title="Supplier not found" description="This supplier is not in the catalog." action={<Link to="/suppliers"><Button>Back to suppliers</Button></Link>}/></>;const save=async(d:SupplierDraft)=>{setSaving(true);try{await supplierService.updateSupplier(supplier.id,d);nav(`/suppliers/${supplier.id}`,{state:{notice:'Supplier details updated.'}})}finally{setSaving(false)}};return <><PageHeader title="Edit supplier" description={`Update ${supplier.name}.`}/><div className="mx-auto max-w-4xl"><SupplierForm key={supplier.id} supplier={supplier} onSave={save} onCancel={()=>nav(`/suppliers/${supplier.id}`)} saving={saving}/></div></>}
