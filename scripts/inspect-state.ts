import { prisma } from '@/lib/db'

async function main() {
  const convId = process.argv[2]
  if (!convId) {
    console.error('usage: tsx --env-file=.env scripts/inspect-state.ts <conversationId>')
    process.exit(1)
  }
  const conv = await prisma.conversation.findUnique({
    where: { id: convId },
    include: {
      product: { select: { code: true } },
    },
  })
  if (!conv) {
    console.error('conversation not found')
    process.exit(1)
  }
  // B4: the application hangs off the activeApplicationId pointer
  const application = conv.activeApplicationId
    ? await prisma.application.findUnique({
        where: { id: conv.activeApplicationId },
        include: { tier: { select: { code: true } }, level: { select: { code: true } } },
      })
    : null
  console.log(
    JSON.stringify(
      {
        productId: conv.productId,
        product: conv.product?.code ?? null,
        candidateProductId: conv.candidateProductId,
                candidateSetAt: conv.candidateSetAt,
        mode: conv.mode,
        application: application
          ? {
              status: application.status,
              tier: application.tier?.code ?? null,
              level: application.level?.code ?? null,
              currentQuestionIndex: application.currentQuestionIndex,
              totalQuestions: application.totalQuestions,
            }
          : null,
      },
      null,
      2,
    ),
  )
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
