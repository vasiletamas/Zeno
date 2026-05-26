import 'dotenv/config'
import { prisma } from '@/lib/db'

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, code: true, isActive: true },
    orderBy: { code: 'asc' },
  })
  console.log(`total: ${products.length}`)
  const nonLower = products.filter((p) => p.code !== p.code.toLowerCase())
  console.log(`non-lowercase codes: ${nonLower.length}`)
  for (const p of products) {
    const mark = p.code !== p.code.toLowerCase() ? '  <-- MIXED CASE' : ''
    console.log(`  ${p.code}  (active=${p.isActive})${mark}`)
  }
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
