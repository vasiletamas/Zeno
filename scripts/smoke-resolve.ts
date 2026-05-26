import 'dotenv/config'
import { resolveProductRef, listAvailableProductRefs } from '@/lib/tools/resolve-product'
import { prisma } from '@/lib/db'

async function main() {
  const cases = [
    { productCode: 'Protect' },
    { productCode: 'protect' },
    { productCode: '  protect  ' },
    { productCode: 'PROTECT' },
    { productCode: 'unknown' },
    { productId: 'cmozcrkyz0007bs0ynxjnvclz' },
  ]

  for (const input of cases) {
    const ref = await resolveProductRef(input)
    console.log(JSON.stringify(input), '→', ref)
  }

  console.log('\navailable:', await listAvailableProductRefs())
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
