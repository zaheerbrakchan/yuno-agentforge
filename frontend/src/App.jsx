import { Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Agents from './pages/Agents.jsx'
import WorkflowBuilder from './pages/WorkflowBuilder.jsx'
import Workflows from './pages/Workflows.jsx'
import Monitor from './pages/Monitor.jsx'
import Channels from './pages/Channels.jsx'

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <Navbar />
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/builder" element={<WorkflowBuilder />} />
          <Route path="/monitor" element={<Monitor />} />
          <Route path="/channels" element={<Channels />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
