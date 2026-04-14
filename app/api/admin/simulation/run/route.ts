import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth/jwt'
import { runSimulation, isSimulationRunning } from '@/lib/simulation/runner'
import type { SimulationConfig } from '@/lib/simulation/types'
import { DEFAULT_CONFIG } from '@/lib/simulation/types'

const COOKIE_NAME = 'zeno_auth'

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (isSimulationRunning()) {
    return NextResponse.json({ error: 'Simulation already running' }, { status: 409 })
  }

  const body = await request.json().catch(() => ({})) as Partial<SimulationConfig>
  const config: SimulationConfig = {
    ...DEFAULT_CONFIG,
    ...body,
    trigger: 'admin',
  }

  // Fire and forget
  runSimulation(config).catch(() => {})

  return NextResponse.json({ message: 'Simulation started', config })
}
