import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { MobileNavigation } from './components/MobileNavigation'
import { PageContainer } from './components/PageContainer'
export function DashboardLayout(){const [mobileOpen,setMobileOpen]=useState(false);return <div className="app-shell flex"><Sidebar/><div className="min-w-0 flex-1"><Header onMenu={()=>setMobileOpen(true)}/><PageContainer><Outlet/></PageContainer></div><MobileNavigation open={mobileOpen} onClose={()=>setMobileOpen(false)}/></div>}
