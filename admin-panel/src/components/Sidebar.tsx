import { NavLink } from 'react-router-dom'

type SidebarProps = {
  isOpen: boolean
  onNavigate: () => void
  onLogout: () => void
}

const navigationItems = [
  { label: 'Dashboard', to: '/dashboard', icon: 'D' },
  { label: 'Reports', to: '/reports', icon: 'R' },
  { label: 'Map', to: '/map', icon: 'M' },
  { label: 'Users', to: '/users', icon: 'U' },
  { label: 'Settings', to: '/settings', icon: 'S' },
]

function Sidebar({ isOpen, onNavigate, onLogout }: SidebarProps) {
  return (
    <aside
      className={isOpen ? 'sidebar sidebar-open' : 'sidebar'}
      aria-label="Sidebar navigation"
    >
      <NavLink
        className="sidebar-brand"
        to="/dashboard"
        onClick={onNavigate}
      >
        <span className="brand-mark" aria-hidden="true">
          R
        </span>
        <span>RoadGuard</span>
      </NavLink>

      <nav className="sidebar-nav" aria-label="Main navigation">
        <span className="sidebar-section-label">WORKSPACE</span>
        {navigationItems.map(({ label, to, icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onNavigate}
            className={({ isActive }) =>
              isActive ? 'sidebar-link sidebar-link-active' : 'sidebar-link'
            }
          >
            <span className="sidebar-link-icon" aria-hidden="true">
              {icon}
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          className="sidebar-link sidebar-logout"
          type="button"
          onClick={onLogout}
        >
          <span className="sidebar-link-icon" aria-hidden="true">
            ↪
          </span>
          <span>Logout</span>
        </button>
        <span className="sidebar-version">RoadGuard Admin Panel</span>
      </div>
    </aside>
  )
}

export default Sidebar
