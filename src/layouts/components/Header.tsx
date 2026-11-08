import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Bell, ChevronDown, Menu, Search } from 'lucide-react'
import { navigationGroups } from '../navigation'

export function Header({onMenu}:{onMenu:()=>void}) {
  const [profileOpen,setProfileOpen]=useState(false)
  const [notificationsOpen,setNotificationsOpen]=useState(false)
  const [search,setSearch]=useState('')
  const navigate=useNavigate()
  const searchInput=useRef<HTMLInputElement>(null)
  const matches=useMemo(()=>navigationGroups.flatMap((group)=>group.items).filter((item)=>item.label.toLowerCase().includes(search.trim().toLowerCase())).slice(0,6),[search])
  useEffect(()=>{const onKeyDown=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();searchInput.current?.focus()}if(event.key==='Escape'){setSearch('');setProfileOpen(false);setNotificationsOpen(false)}};window.addEventListener('keydown',onKeyDown);return()=>window.removeEventListener('keydown',onKeyDown)},[])

  return <header className="relative flex h-[72px] items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
    <div className="flex min-w-0 items-center gap-3">
      <button onClick={onMenu} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Open navigation"><Menu size={20}/></button>
      <div className="relative hidden w-64 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-slate-400 sm:flex">
        <Search size={15}/><input ref={searchInput} aria-label="Search navigation" value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search modules..." className="min-w-0 flex-1 bg-transparent py-2 text-xs text-slate-700 outline-none placeholder:text-slate-400"/><kbd className="rounded border bg-white px-1.5 py-0.5 text-[10px]">Ctrl K</kbd>
        {search.trim()&&<div className="absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg">{matches.length?matches.map((item)=><Link key={item.path} to={item.path} onClick={()=>setSearch('')} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"><item.icon size={15}/>{item.label}</Link>):<p className="px-3 py-2 text-xs text-slate-500">No matching pages</p>}</div>}
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-2 sm:gap-3">
      <div className="relative"><button onClick={()=>{setNotificationsOpen(!notificationsOpen);setProfileOpen(false)}} aria-label="Notifications" aria-expanded={notificationsOpen} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Bell size={19}/><span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border-2 border-white bg-rose-500"/></button>{notificationsOpen&&<div className="absolute right-0 top-12 z-40 w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-lg"><h2 className="text-sm font-semibold text-slate-800">Notifications</h2><p className="mt-2 text-xs leading-5 text-slate-500">12 products are running low on stock.</p><Link to="/inventory" onClick={()=>setNotificationsOpen(false)} className="mt-3 inline-block text-xs font-semibold text-blue-600">Review inventory</Link></div>}</div>
      <div className="mx-1 h-8 border-l border-slate-200"/>
      <div className="relative"><button onClick={()=>{setProfileOpen(!profileOpen);setNotificationsOpen(false)}} aria-expanded={profileOpen} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-slate-50"><div className="grid h-8 w-8 place-items-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">AK</div><div className="hidden text-left sm:block"><div className="text-xs font-semibold text-slate-800">Ayesha Khan</div><div className="text-[10px] text-slate-400">Administrator</div></div><ChevronDown size={14} className="hidden text-slate-400 sm:block"/></button>{profileOpen&&<div className="absolute right-0 top-12 z-40 min-w-40 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"><Link to="/settings" onClick={()=>setProfileOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Profile settings</Link><button onClick={()=>{setProfileOpen(false);navigate('/login')}} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50">Sign out</button></div>}</div>
    </div>
  </header>
}
