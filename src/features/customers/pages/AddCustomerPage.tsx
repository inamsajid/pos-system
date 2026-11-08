import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { CustomerForm } from '../components/CustomerForm'
import { customerService } from '../services/customerService'
import type { CustomerDraft } from '../types/customer.types'
export function AddCustomerPage(){const navigate=useNavigate();const[saving,setSaving]=useState(false);const save=async(draft:CustomerDraft,another:boolean)=>{setSaving(true);try{await customerService.createCustomer(draft);if(!another)navigate('/customers',{state:{notice:`${draft.name} was added.`}})}finally{setSaving(false)}};return <><PageHeader title="Add customer" description="Create a customer profile for your business."/><div className="mx-auto max-w-4xl"><CustomerForm onSubmit={save} onCancel={()=>navigate('/customers')} saving={saving}/></div></>}
