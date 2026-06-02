import { config } from 'dotenv'
config()
import { prisma } from '@/lib/db'

async function main() {
  const conv = await prisma.conversation.findUnique({
    where: { id: 'cmpcfhona0000v00yrvb4d3f1' },
    include: {
      answers: true,
      application: {
        include: {
          tier: { select: { name: true, code: true } },
          level: { select: { name: true, code: true } },
        },
      },
      customer: {
        include: {
          insights: { orderBy: { createdAt: 'asc' } },
        },
      },
      workflowSession: {
        include: { currentStep: { select: { code: true, name: true, agentInstructions: true } } },
      },
    },
  })

  if (!conv) { console.error('not found'); process.exit(1) }

  console.log('=== APPLICATION ===')
  if (conv.application) {
    console.log('id:', conv.application.id)
    console.log('status:', conv.application.status)
    console.log('tier:', conv.application.tier?.name ?? '(null)', 'code:', conv.application.tier?.code ?? '(null)')
    console.log('level:', conv.application.level?.name ?? '(null)', 'code:', conv.application.level?.code ?? '(null)')
    console.log('currentQuestion:', conv.application.currentQuestionIndex, '/', conv.application.totalQuestions)
    console.log('answers:', JSON.stringify(conv.answers, null, 2).slice(0, 500))
  } else {
    console.log('(no application)')
  }
  console.log('')
  console.log('=== CUSTOMER INSIGHTS ===')
  conv.customer.insights.forEach((i) => {
    console.log(`  ${i.category}/${i.key} = ${i.value}  (conf=${i.confidence})`)
  })
  console.log('')
  console.log('=== EXTRACTED PROFILE ===')
  console.log(JSON.stringify(conv.customer.extractedProfile, null, 2).slice(0, 400))
  console.log('')
  console.log('=== CURRENT WORKFLOW STEP ===')
  console.log('code:', conv.workflowSession?.currentStep.code)
  console.log('name:', conv.workflowSession?.currentStep.name)
  console.log('agentInstructions:')
  console.log((conv.workflowSession?.currentStep.agentInstructions ?? '').slice(0, 1000))

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
