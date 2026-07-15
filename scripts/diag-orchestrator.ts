import { config } from 'dotenv'
config()
import { loadTurnContext } from '../lib/chat/turn-context'
import { loadStateGrounding, type StateGroundingInput } from '../lib/chat/context-loaders'

async function main() {
  const ctx = await loadTurnContext('cmpdx52t6001gv00yv4km5usg', 'cmp1728wb0001mw0y1sanxlbp')
  console.log('turn context loaded OK')
  console.log('product:', ctx.conversation.product)
  console.log('consent:', {
    gdprConsentAt: ctx.customer.gdprConsentAt,
    aiDisclosureAcknowledgedAt: ctx.customer.aiDisclosureAcknowledgedAt,
  })

  const stateInput: StateGroundingInput = {
    application: ctx.conversation.application
      ? {
          id: 'application',
          status: ctx.conversation.application.status,
          currentQuestionIndex: ctx.conversation.application.currentQuestionIndex,
          totalQuestions: ctx.conversation.application.totalQuestions,
        }
      : null,
    product: ctx.conversation.product
      ? { code: ctx.conversation.product.code, name: ctx.conversation.product.name }
      : null,
    customer: {
      gdprConsentAt: ctx.customer.gdprConsentAt,
      gdprConsentScope: ctx.customer.gdprConsentScope,
      aiDisclosureAcknowledgedAt: ctx.customer.aiDisclosureAcknowledgedAt,
    },
  }
  console.log('---state grounding---')
  console.log(loadStateGrounding(stateInput))
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
