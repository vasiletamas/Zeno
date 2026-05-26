import { config } from 'dotenv'
config()
import { PrismaClient } from '../lib/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

async function main() {
  const steps = await prisma.workflowStep.findMany({
    select: { code: true, name: true, salesPlaybook: true },
  })
  console.log('--- WorkflowStep rows ---')
  for (const s of steps) {
    const len = (s.salesPlaybook || '').length
    console.log(`  ${s.code} | ${s.name} | salesPlaybook: ${len === 0 ? '(empty)' : len + ' chars'}`)
  }

  const packs = await prisma.skillPack.findMany({
    select: { slug: true, promptSections: true },
  })
  console.log('\n--- SkillPack promptSections keys (any non-domainGuidance is stripped at runtime) ---')
  for (const p of packs) {
    const keys = Object.keys((p.promptSections as Record<string, unknown>) || {})
    console.log(`  ${p.slug}: [${keys.join(', ')}]`)
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
