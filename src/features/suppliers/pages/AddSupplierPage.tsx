import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { SupplierForm } from '../components/SupplierForm'
import { supplierService } from '../services/supplierService'
import type { SupplierDraft } from '../types/supplier.types'
export function AddSupplierPage(){const nav=useNavigate();const[saving,setSaving]=useState(false);const save=async(d:SupplierDraft,another:boolean)=>{setSaving(true);try{await supplierService.createSupplier(d);if(!another)nav('/suppliers',{state:{notice:`${d.name} added.`}})}finally{setSaving(false)}};return <><PageHeader title="Add supplier" description="Add a supplier to your catalog."/><div className="mx-auto max-w-4xl"><SupplierForm onSave={save} onCancel={()=>nav('/suppliers')} saving={saving}/></div></>}
