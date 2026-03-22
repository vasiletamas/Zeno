'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FileText,
  Shield,
  MessageCircle,
  Settings,
  Users,
  Menu,
  X,
} from 'lucide-react'
import { useState } from 'react'

interface AdminSidebarProps {
  role: 'ADMIN' | 'OPERATOR'
}

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, adminOnly: false },
  { href: '/admin/applications', label: 'Aplicatii', icon: FileText, adminOnly: false },
  { href: '/admin/policies', label: 'Polite', icon: Shield, adminOnly: false },
  { href: '/admin/conversations', label: 'Conversatii', icon: MessageCircle, adminOnly: true },
  { href: '/admin/agents', label: 'Agenti AI', icon: Settings, adminOnly: true },
  { href: '/admin/users', label: 'Utilizatori', icon: Users, adminOnly: true },
]

export default function AdminSidebar({ role }: AdminSidebarProps) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || role === 'ADMIN',
  )

  function isActive(href: string): boolean {
    if (href === '/admin') return pathname === '/admin'
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 rounded-md bg-forest p-2 text-soft-white md:hidden"
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Overlay for mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-night/30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 z-40 h-full w-56 border-r border-warm-border bg-soft-white
          transition-transform duration-200
          md:static md:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex h-14 items-center border-b border-warm-border px-4">
          <span className="font-display text-lg text-forest">Zeno</span>
          <span className="ml-2 text-xs text-muted">Admin</span>
        </div>

        <nav className="mt-2 flex flex-col gap-1 px-2">
          {visibleItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`
                  flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium
                  transition-colors duration-150
                  ${
                    active
                      ? 'bg-forest text-soft-white'
                      : 'text-night hover:bg-linen'
                  }
                `}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
