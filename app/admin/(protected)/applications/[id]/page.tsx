/**
 * Application Detail Page
 *
 * Server component. Loads full application with customer, answers,
 * quote, and policy. Displays all data + action buttons.
 */

import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import ApplicationDetailClient from './client'

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      customer: true,
      product: { select: { name: true, code: true } },
      tier: { select: { name: true, code: true } },
      level: { select: { name: true, code: true } },
      // B4: answers key on the application itself
      answers: {
        include: {
          question: {
            include: {
              group: { select: { name: true, code: true } },
            },
          },
        },
        orderBy: { answeredAt: 'asc' },
      },
      quote: true,
    },
  })

  if (!application) {
    notFound()
  }

  // Load policy separately via quote
  const policy = application.quote
    ? await prisma.policy.findUnique({
        where: { quoteId: application.quote.id },
      })
    : null

  // Serialize dates for client component
  const serialized = JSON.parse(JSON.stringify({
    application,
    policy,
  }))

  return <ApplicationDetailClient data={serialized} />
}
