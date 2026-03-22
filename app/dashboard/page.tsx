/**
 * Customer Dashboard Page (server component)
 *
 * Loads User -> Customer -> Policies (most recent first).
 * If no policies: shows "Nu ai polite active" message.
 * If has policies: renders PolicyHeroCard + QuickActions + DocumentList.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken } from '@/lib/auth/jwt'
import { prisma } from '@/lib/db'
import PolicyHeroCard from '@/components/dashboard/policy-hero-card'
import QuickActions from '@/components/dashboard/quick-actions'
import DocumentList from '@/components/dashboard/document-list'
import type { PolicyCardData } from '@/components/dashboard/policy-hero-card'

export default async function DashboardPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get('zeno_auth')?.value
  if (!token) redirect('/dashboard/login')

  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'CUSTOMER') redirect('/dashboard/login')

  // Load user with customer and policies
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: {
      customer: {
        include: {
          policies: {
            orderBy: { createdAt: 'desc' },
            include: {
              quote: {
                include: {
                  application: {
                    include: {
                      tier: true,
                      level: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!user?.customer) {
    redirect('/dashboard/login')
  }

  const policies = user.customer.policies

  if (policies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-xl border border-warm-border bg-linen px-8 py-12">
          <p className="text-lg font-medium text-night">
            Nu ai polite active
          </p>
          <p className="mt-2 text-sm text-muted">
            Vorbeste cu Zeno pentru a obtine o polita de asigurare.
          </p>
          <a
            href="/chat"
            className="mt-6 inline-block min-h-[44px] rounded-[10px] bg-forest px-6 py-3 text-[15px] font-medium text-linen transition-colors hover:bg-sage"
          >
            Vorbeste cu Zeno
          </a>
        </div>
      </div>
    )
  }

  // Show the most recent policy
  const latestPolicy = policies[0]
  const tier = latestPolicy.quote?.application?.tier
  const level = latestPolicy.quote?.application?.level
  const hasAddon = latestPolicy.quote?.application?.includesAddon ?? false

  const policyData: PolicyCardData = {
    id: latestPolicy.id,
    tierName: tier
      ? (typeof tier.name === 'object' && tier.name !== null
          ? (tier.name as Record<string, string>).ro ?? String(tier.name)
          : String(tier.name))
      : 'Standard',
    levelName: level
      ? (typeof level.name === 'object' && level.name !== null
          ? (level.name as Record<string, string>).ro ?? String(level.name)
          : String(level.name))
      : '',
    hasAddon,
    status: latestPolicy.status as PolicyCardData['status'],
    premiumMonthly: latestPolicy.premiumMonthly,
    premiumAnnual: latestPolicy.premiumAnnual,
    currency: latestPolicy.currency,
    coverageSummary: (latestPolicy.coverageSummary as Record<string, unknown>) ?? {},
    paymentFrequency: latestPolicy.paymentFrequency,
    effectiveFrom: latestPolicy.effectiveFrom?.toISOString() ?? null,
    effectiveUntil: latestPolicy.effectiveUntil?.toISOString() ?? null,
  }

  const isActive = latestPolicy.status === 'ACTIVE'

  return (
    <div className="flex flex-col gap-6">
      <PolicyHeroCard policy={policyData} />
      <QuickActions policyActive={isActive} />
      <DocumentList policyActive={isActive} />
    </div>
  )
}
