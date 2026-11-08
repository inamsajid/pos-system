import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { CustomerForm } from '../components/CustomerForm'
import { customerService } from '../services/customerService'
import type { Customer, CustomerDraft } from '../types/customer.types'
export function EditCustomerPage(){const{id}=useParams();const navigate=useNavigate();const[customer,setCustomer]=useState<Customer>();const[loading,setLoading]=useState(true);const[saving,setSaving]=useState(false);useEffect(()=>{void customerService.getCustomerById(id??'').then(setCustomer).finally(()=>setLoading(false))},[id]);if(loading)return <p role="status" className="p-8 text-sm text-slate-500">Loading customer…</p>;if(!customer)return <><PageHeader title="Customer not found" description="This customer is not in the current catalog." action={<Link to="/customers"><Button>Back to customers</Button></Link>}/></>;const save=async(draft:CustomerDraft)=>{setSaving(true);try{await customerService.updateCustomer(customer.id,draft);navigate(`/customers/${customer.id}`,{state:{notice:'Customer details updated.'}})}finally{setSaving(false)}};return <><PageHeader title="Edit customer" description={`Update details for ${customer.name}.`}/><div className="mx-auto max-w-4xl"><CustomerForm key={customer.id} customer={customer} onSubmit={save} onCancel={()=>navigate(`/customers/${customer.id}`)} saving={saving}/></div></>}
