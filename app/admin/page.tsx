/**
 * Admin Dashboard
 *
 * Server component. Loads summary counts from DB and renders
 * 4 summary cards + recent 10 applications table.
 */

import { prisma } from '@/lib/db'
import ApplicationTable from '@/components/admin/application-table'

export default async function AdminDashboardPage() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [openApplications, pendingPolicies, activePolicies, conversationsToday, recentApplications] =
    await Promise.all([
      prisma.application.count({ where: { status: 'OPEN' } }),
      prisma.policy.count({
        where: { status: { in: ['PENDING_SUBMISSION', 'SUBMITTED'] } },
      }),
      prisma.policy.count({ where: { status: 'ACTIVE' } }),
      prisma.conversation.count({ where: { createdAt: { gte: today } } }),
      prisma.application.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { name: true, email: true } },
          product: { select: { name: true } },
        },
      }),
    ])

  const cards = [
    { label: 'Aplicatii noi', value: openApplications, color: 'bg-sage/10 text-sage' },
    { label: 'Polite in asteptare', value: pendingPolicies, color: 'bg-sand/10 text-sand' },
    { label: 'Polite active', value: activePolicies, color: 'bg-forest/10 text-forest' },
    { label: 'Conversatii azi', value: conversationsToday, color: 'bg-info/10 text-info' },
  ]

  return (
    <div>
      <h2 className="mb-6 text-xl font-medium text-night">Dashboard</h2>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-warm-border bg-white p-5"
          >
            <p className="text-sm text-muted">{card.label}</p>
            <p className={`mt-1 text-2xl font-medium ${card.color.split(' ')[1]}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Recent applications */}
      <div>
        <h3 className="mb-4 text-lg font-medium text-night">Aplicatii recente</h3>
        <ApplicationTable applications={recentApplications} />
      </div>
    </div>
  )
}
