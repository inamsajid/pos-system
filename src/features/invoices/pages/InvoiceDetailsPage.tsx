import { useEffect,useState } from 'react'
import { Link,useParams } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { invoiceService } from '../services/invoiceService'
import type { CheckoutSale } from '../../pos/types/checkout.types'
import { InvoiceDocument } from '../components/InvoiceDocument'
import './invoice.css'
export function InvoiceDetailsPage(){const{invoiceId:id}=useParams();const[sale,setSale]=useState<CheckoutSale>();const[compact,setCompact]=useState(false);useEffect(()=>{void invoiceService.getInvoiceById(id??'').then(setSale)},[id]);if(!sale)return <PageHeader title="Invoice not found" description="This invoice is not available in the completed sales repository." action={<Link to="/invoices"><Button>Back to invoices</Button></Link>}/>;return <div className="invoice-screen"><PageHeader title="Invoice" description={`${sale.invoiceNumber} · sale ${sale.saleNumber}`} action={<div className="flex flex-wrap gap-2"><Link to={`/sales/${sale.id}`}><Button>View sale</Button></Link><Button onClick={()=>{setCompact(false);window.setTimeout(()=>window.print(),100)}}>Print invoice</Button><Button variant="primary" onClick={()=>{setCompact(true);window.setTimeout(()=>window.print(),100)}}>Print receipt</Button></div>}/><div className={compact?'invoice-is-compact':''}><InvoiceDocument sale={sale} compact={compact}/></div></div>}
