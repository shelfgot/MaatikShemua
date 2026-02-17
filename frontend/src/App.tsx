import { Routes, Route, Link } from 'react-router-dom'
import { SkipLinks } from './components/SkipLink'
import IndexPage from './pages/IndexPage'
import EditorPage from './pages/EditorPage'
import ModelsPage from './pages/ModelsPage'
import TasksDashboard from './pages/TasksDashboard'

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SkipLinks />
      
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="text-2xl font-bold text-gray-900 font-hebrew hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-600 rounded"
            dir="rtl"
            aria-label="Maatik Shemua home"
          >
            מעתיק שמועה
          </Link>
          <nav className="flex gap-4">
            <Link to="/" className="text-gray-600 hover:text-gray-900">Documents</Link>
            <Link to="/models" className="text-gray-600 hover:text-gray-900">Models</Link>
            <Link to="/tasks" className="text-gray-600 hover:text-gray-900">Tasks</Link>
          </nav>
        </div>
      </header>
      
      <main id="main-content" className="max-w-7xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/document/:documentId" element={<IndexPage />} />
          <Route path="/document/:documentId/page/:pageId" element={<EditorPage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/tasks" element={<TasksDashboard />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
