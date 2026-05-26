import { config } from 'dotenv'
config()
import { PrismaClient } from '../lib/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { seedSkillPacks } from '../prisma/seeds/seed-skill-packs'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

async function main() {
  await seedSkillPacks(prisma)

  const packs = await prisma.skillPack.findMany({
    where: { slug: { in: ['life-insurance-discovery', 'life-insurance-closing'] } },
    select: { slug: true, promptSections: true },
  })
  console.log('\n--- after re-seed ---')
  for (const p of packs) {
    const sections = p.promptSections as Record<string, string>
    const keys = Object.keys(sections)
    console.log(`  ${p.slug}: keys=[${keys.join(', ')}]`)
    for (const k of keys) {
      console.log(`    ${k}: ${(sections[k] || '').length} chars`)
    }
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
