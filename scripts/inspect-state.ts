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
      application: {
        include: { tier: { select: { code: true } }, level: { select: { code: true } } },
      },
    },
  })
  if (!conv) {
    console.error('conversation not found')
    process.exit(1)
  }
  console.log(
    JSON.stringify(
      {
        productId: conv.productId,
        product: conv.product?.code ?? null,
        candidateProductId: conv.candidateProductId,
        candidateConfidence: conv.candidateConfidence,
        candidateSetAt: conv.candidateSetAt,
        mode: conv.mode,
        application: conv.application
          ? {
              status: conv.application.status,
              tier: conv.application.tier?.code ?? null,
              level: conv.application.level?.code ?? null,
              currentQuestionIndex: conv.application.currentQuestionIndex,
              totalQuestions: conv.application.totalQuestions,
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
