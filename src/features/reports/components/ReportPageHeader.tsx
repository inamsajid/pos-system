import { Download, Printer } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { useOptionalAuth } from '../../auth/context/useAuth'

export function ReportPageHeader({ title, description, onExport, back = false }: { title: string; description: string; onExport?: () => void; back?: boolean }) {
  const auth = useOptionalAuth()
  const businessName = auth?.activeBusiness?.name || 'Store Workspace'
  return <><p className="hidden print:block text-sm font-semibold text-slate-500">{businessName} · Business Report</p><PageHeader title={title} description={description} action={<div className="no-print flex flex-wrap gap-2">{back && <Link to="/reports"><Button>All reports</Button></Link>}{onExport && <Button onClick={onExport}><Download size={15} />Export CSV</Button>}<Button onClick={() => window.print()}><Printer size={15} />Print / PDF</Button></div>} /></>
}
