import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { MobileNavigation } from './components/MobileNavigation'
import { PageContainer } from './components/PageContainer'
import { OfflineStatusBanner } from '../components/common/OfflineStatusIndicator'

export function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="app-shell flex">
      <Sidebar />
      <div className="min-w-0 flex-1 flex flex-col min-h-screen">
        <Header onMenu={() => setMobileOpen(true)} />
        <OfflineStatusBanner />
        <PageContainer>
          <Outlet />
        </PageContainer>
      </div>
      <MobileNavigation open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </div>
  )
}
