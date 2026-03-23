/**
 * GET /api/health
 *
 * Health check endpoint for Azure App Service probes.
 * No auth required.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// Read version once at module load
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { version } = require('../../../package.json') as { version: string }

export async function GET() {
  let database: 'connected' | 'error' = 'connected'

  try {
    await prisma.$queryRawUnsafe('SELECT 1')
  } catch {
    database = 'error'
  }

  const status = database === 'connected' ? 'ok' : 'degraded'
  const httpStatus = database === 'connected' ? 200 : 503

  return NextResponse.json(
    {
      status,
      version,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database,
    },
    { status: httpStatus },
  )
}
