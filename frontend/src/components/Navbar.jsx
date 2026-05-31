import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Bot, Workflow, ListTree, Activity, Cpu, Radio } from 'lucide-react'

const links = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/workflows', label: 'Workflows', icon: ListTree },
  { to: '/builder', label: 'Builder', icon: Workflow },
  { to: '/monitor', label: 'Monitor', icon: Activity },
  { to: '/channels', label: 'Channels', icon: Radio },
]

export default function Navbar() {
  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/80 px-6 py-3 backdrop-blur">
      <div className="flex items-center gap-2 text-lg font-bold text-white">
        <Cpu className="h-6 w-6 text-indigo-400" />
        Yuno <span className="text-indigo-400">AgentForge</span>
      </div>
      <nav className="flex items-center gap-1">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}
