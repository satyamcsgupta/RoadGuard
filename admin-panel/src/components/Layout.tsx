import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import Sidebar from './Sidebar'

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/reports': 'Reports',
  '/map': 'Map',
  '/users': 'Users',
  '/settings': 'Settings',
}

function Layout() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { logout } = useAuth()
  const pageTitle = pageTitles[location.pathname] ?? 'Dashboard'

  const closeMenu = () => setIsMenuOpen(false)
  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="app-layout">
      <Sidebar
        isOpen={isMenuOpen}
        onNavigate={closeMenu}
        onLogout={handleLogout}
      />
      {isMenuOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Close navigation menu"
          onClick={closeMenu}
        />
      )}

      <div className="app-main">
        <header className="topbar">
          <button
            className="menu-toggle"
            type="button"
            aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={isMenuOpen}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="topbar-title-group">
            <span className="topbar-eyebrow">ROADGUARD ADMIN</span>
            <span className="topbar-title">{pageTitle}</span>
          </div>
        </header>

        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default Layout
