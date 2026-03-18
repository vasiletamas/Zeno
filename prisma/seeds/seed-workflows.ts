import { PrismaClient } from '../../lib/generated/prisma/client'

// ============================================
// Types
// ============================================

interface StepDef {
  code: string
  name: string
  orderIndex: number
  type: string
  autoTool: string | null
  allowedTools: string[]
  agentInstructions: string | null
  uiAction: string | null
  transitions: TransitionDef[]
}

interface TransitionDef {
  conditionType: string
  conditionValue: string
  label: string
  priority: number
  toStepCode: string
}

interface WorkflowDef {
  name: string
  code: string
  description: string
  isActive: boolean
  version: number
  steps: StepDef[]
}

// ============================================
// Workflow Definitions
// ============================================

const PRODUCT_DISCOVERY: WorkflowDef = {
  name: 'Sales Journey',
  code: 'product-discovery',
  description:
    'Full sales journey workflow — from first greeting through product selection. Activates at conversation start and chains to product-specific workflows when the customer chooses a product.',
  isActive: true,
  version: 2,
  steps: [
    {
      code: 'needs_discovery',
      name: 'Needs Discovery & Product Recommendation',
      orderIndex: 1,
      type: 'INTERACTIVE',
      autoTool: null,
      allowedTools: [
        'list_products',
        'get_product_info',
        'compare_products',
        'get_customer_profile',
        'update_customer_profile',
        'set_conversation_product',
        'get_objection_strategy',
      ],
      agentInstructions: `You are in the needs discovery phase. No product has been selected yet. Your goal is to understand the customer's situation and guide them to the right insurance product.

HOW TO CONDUCT THIS CONVERSATION:
- Start by welcoming the customer warmly. Ask what brought them here today.
- Listen actively to what they share. Build on their words — don't follow a script.
- Ask questions that are relevant to their situation and to the products you can offer. Do NOT ask random qualifying questions (like "Are you a smoker?") unless a product's features or exclusions make it relevant to what they've told you.
- Use get_customer_profile early to check if you already know things about this customer (previous interactions, family info, etc.).
- Use update_customer_profile to save important details you learn during the conversation.

PRODUCT DISCOVERY:
- When the customer's needs become clear, use list_products to find matching options for their insurance type.
- Use get_product_info to get full details on products that match their situation.
- Present 1-2 products naturally, explaining WHY each one fits based on what they've shared. Don't just list features — connect them to the customer's expressed needs.
- If the customer is comparing options, use compare_products to show the differences clearly.
- Use get_objection_strategy if the customer raises concerns or hesitations.

WHEN TO SET THE PRODUCT:
- Call set_conversation_product as soon as the customer shows alignment with a specific product.
- Alignment signals: "That sounds good", "Let's go with that one", "Yes, I'm interested", confirming after your recommendation, asking about next steps for a specific product.
- Do NOT over-qualify. Once you know the insurance type and the customer has expressed a preference, set the product. You don't need every detail (exact budget, riders, etc.) before setting it.
- If the customer clearly states what they want from the start ("I want life insurance"), confirm briefly and set the product. Don't force unnecessary discovery.

CRITICAL TOOL RULES:
- ALWAYS use tools rather than describing actions. Call list_products, don't say "we have life insurance products."
- When a tool succeeds, speak in PAST TENSE: "I've found 3 options that match your needs" not "I will search for products."
- When a tool fails, explain the error and suggest alternatives.
- Don't ask for permission to use tools — just use them when appropriate.

After you call set_conversation_product, a product-specific workflow will activate automatically to guide the next steps (regulatory forms, application, quote).`,
      uiAction: null,
      transitions: [
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'product_selected',
          label: 'Customer chose a product',
          priority: 0,
          toStepCode: 'product_confirmed',
        },
      ],
    },
    {
      code: 'product_confirmed',
      name: 'Product Confirmed',
      orderIndex: 2,
      type: 'AUTO',
      autoTool: null,
      allowedTools: [],
      agentInstructions:
        'The customer has selected a product. This workflow is complete — a product-specific workflow will be started automatically based on the insurance type they chose.',
      uiAction: null,
      transitions: [],
    },
  ],
}

const LIFE_INSURANCE_PURCHASE: WorkflowDef = {
  name: 'Life Insurance Purchase',
  code: 'life-insurance-purchase',
  description:
    'Complete purchase flow for life insurance products. Covers DNT validation, underwriting application, quote generation, and policy issuance.',
  isActive: true,
  version: 1,
  steps: [
    {
      code: 'dnt_check',
      name: 'Check DNT Status',
      orderIndex: 1,
      type: 'AUTO',
      autoTool: 'check_dnt_status',
      allowedTools: ['check_dnt_status'],
      agentInstructions: `Check if the customer has a valid, signed DNT (needs analysis document) that covers LIFE insurance. Call check_dnt_status immediately — the result determines the next step automatically.

If the customer asks what this is: a DNT is a regulatory requirement that ensures we understand your needs before making recommendations. It's quick and helps us find the best coverage for your situation.

TOOL RULES: Always use tools rather than describing actions. When a tool succeeds, speak in PAST TENSE ("I've checked your status"). When it fails, explain the error and suggest alternatives.`,
      uiAction: null,
      transitions: [
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'dnt_valid_and_signed',
          label: 'DNT is valid and signed',
          priority: 0,
          toStepCode: 'application_check',
        },
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'dnt_missing',
          label: 'No valid DNT exists',
          priority: 0,
          toStepCode: 'dnt_questionnaire',
        },
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'dnt_not_signed',
          label: 'DNT complete but not signed',
          priority: 0,
          toStepCode: 'dnt_sign',
        },
      ],
    },
    {
      code: 'dnt_questionnaire',
      name: 'DNT Questionnaire',
      orderIndex: 2,
      type: 'INTERACTIVE',
      autoTool: null,
      allowedTools: ['start_dnt_questionnaire', 'save_dnt_answer'],
      agentInstructions: `The customer needs to complete a needs analysis questionnaire (DNT) for life insurance. This is a regulatory requirement before we can proceed.

HOW TO GUIDE THE QUESTIONNAIRE:
1. Call start_dnt_questionnaire with insuranceType LIFE to begin and get the first question.
2. The UI will display each question as a card below your message. You do NOT need to repeat the question text — the card handles display.
3. Your message should be a brief, natural transition: "Let's start with a few questions about your needs." or "Next question:" — keep it short and warm.
4. When the customer answers (via the card or typing), call save_dnt_answer with:
   - questionId: from the [ACTIVE QUESTIONNAIRE] context (if available)
   - answer: the option VALUE that matches their response
   For MULTIPLE_CHOICE/DROPDOWN: map their text to the matching option value (e.g., "da" → "yes_all")
   For BOOLEAN: "true" for yes/da, "false" for no/nu
   For OPEN_ENDED/NUMBER: pass their text directly
5. The tool returns the next question automatically, or isComplete: true when done.
6. If the customer asks WHY this is needed: "It's a legal requirement that helps us understand your situation and recommend the right coverage. It only takes a few minutes."

IMPORTANT:
- Do NOT re-ask a question that's already shown in the UI card.
- When a questionnaire question is active, IMMEDIATELY call save_dnt_answer when the user responds.
- If the customer already has a partial DNT, only unanswered questions will be shown.

TOOL RULES: Always use tools rather than describing actions. Speak in PAST TENSE for completed actions ("I've recorded your answer"). Don't ask permission to use tools.`,
      uiAction: null,
      transitions: [
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'dnt_questions_complete',
          label: 'All DNT questions answered',
          priority: 0,
          toStepCode: 'dnt_sign',
        },
      ],
    },
    {
      code: 'dnt_sign',
      name: 'Sign DNT',
      orderIndex: 3,
      type: 'INTERACTIVE',
      autoTool: null,
      allowedTools: ['sign_dnt', 'start_application', 'get_application_status'],
      agentInstructions: `The needs analysis questionnaire is complete. Now the customer needs to electronically sign it.

HOW TO HANDLE SIGNING:
1. Let the customer know the questionnaire is done — congratulate their progress.
2. Explain briefly: "To continue, we need your electronic signature on the needs analysis, along with consent for data processing. This is standard procedure."
3. When they confirm, call sign_dnt with confirmSignature: true and gdprConsent: true.
4. If they hesitate: reassure them about data protection. Their data is handled according to GDPR regulations and used only for this insurance assessment.

AFTER SIGNING SUCCEEDS:
When the DNT is signed successfully, the workflow will automatically transition to start the application.
The system will call start_application automatically — you don't need to call it yourself.
Simply confirm the signature: "Perfect, your needs analysis has been signed! Let's continue with your application."

Keep it simple and warm — don't read legal text, just confirm they agree to proceed.

TOOL RULES: Always use tools rather than describing actions. Speak in PAST TENSE for completed actions ("Your needs analysis has been signed"). Don't ask permission to use tools.`,
      uiAction: null,
      transitions: [
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'dnt_signed',
          label: 'DNT signed successfully',
          priority: 0,
          toStepCode: 'application_start',
        },
      ],
    },
    {
      code: 'application_check',
      name: 'Check Application Status',
      orderIndex: 4,
      type: 'AUTO',
      autoTool: 'get_application_status',
      allowedTools: ['get_application_status'],
      agentInstructions: `Check if there is an existing life insurance application for this customer. Call get_application_status immediately — do not wait for a user message.

Possible outcomes:
- No existing application → call start_application right away to begin
- Paused application → ask if they want to resume or start fresh
- Completed application → proceed to quote generation

IMPORTANT: This is an AUTO step. Call get_application_status as soon as you reach this step. If there's no application, follow up immediately with start_application.

TOOL RULES: Always use tools rather than describing actions. Speak in PAST TENSE for completed actions.`,
      uiAction: null,
      transitions: [
        {
          conditionType: 'DATA_CHECK',
          conditionValue: 'no_existing_application',
          label: 'No existing application',
          priority: 0,
          toStepCode: 'application_start',
        },
        {
          conditionType: 'DATA_CHECK',
          conditionValue: 'existing_paused_application',
          label: 'Found paused application',
          priority: 1,
          toStepCode: 'application_resume_prompt',
        },
        {
          conditionType: 'DATA_CHECK',
          conditionValue: 'existing_completed_application',
          label: 'Application already completed',
          priority: 1,
          toStepCode: 'generate_quote',
        },
      ],
    },
    {
      code: 'application_start',
      name: 'Start Application',
      orderIndex: 5,
      type: 'AUTO',
      autoTool: 'start_application',
      allowedTools: ['start_application'],
      agentInstructions: `Start a new life insurance application. Call start_application — it will create the application and return the first underwriting question.

Transition naturally: "Great, your needs analysis is signed. Let's move on to your application — I'll guide you through it step by step."

TOOL RULES: Always use tools rather than describing actions. Speak in PAST TENSE for completed actions ("I've started your application").`,
      uiAction: null,
      transitions: [
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'application_started',
          label: 'Application created',
          priority: 0,
          toStepCode: 'application_fill',
        },
      ],
    },
    {
      code: 'application_resume_prompt',
      name: 'Resume Application Prompt',
      orderIndex: 6,
      type: 'DECISION',
      autoTool: null,
      allowedTools: ['resume_application', 'cancel_application', 'start_application'],
      agentInstructions: `The customer has a paused life insurance application.

HOW TO HANDLE:
1. Welcome them back warmly. Tell them you found their previous application.
2. Share progress: how many questions they'd already answered, when it was started.
3. Ask if they'd like to continue from where they stopped or start fresh.
4. If they choose to resume: call resume_application.
5. If they choose to start fresh: call cancel_application on the old one, then call start_application.

Be positive — they came back, which means they're still interested.

TOOL RULES: Always use tools rather than describing actions. Speak in PAST TENSE for completed actions.`,
      uiAction: null,
      transitions: [
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'application_started',
          label: 'Application resumed or restarted',
          priority: 0,
          toStepCode: 'application_fill',
        },
      ],
    },
    {
      code: 'application_fill',
      name: 'Fill Application',
      orderIndex: 7,
      type: 'INTERACTIVE',
      autoTool: null,
      allowedTools: ['save_application_answer', 'cancel_application', 'get_application_status'],
      agentInstructions: `The customer is filling out the life insurance underwriting application. These questions determine the risk assessment and premium calculation.

HOW TO GUIDE THE APPLICATION:
1. The UI displays each question as a card below your message. You do NOT need to repeat the question — the card handles display.
2. Your message should be brief transitions: "Next question:", "Almost there!", "Let's continue." — keep it warm and encouraging.
3. When the customer answers (via the card or typing), call save_application_answer with:
   - answer: the option VALUE that matches their response
   For MULTIPLE_CHOICE/DROPDOWN: map their text to the matching option value
   For BOOLEAN: "true" for yes/da, "false" for no/nu
   For OPEN_ENDED/NUMBER: pass their text directly
4. The tool returns the next question, or isComplete: true with readyForQuote: true when done.
5. Track progress: let the customer know how far along they are when appropriate.

LIFE INSURANCE NOTES:
- Beneficiary question requires full name and relationship type
- Coverage amount may relate to income data collected in the DNT
- Standard coverage guideline: 10x annual income, or mortgage balance + 5 years expenses
- Duration options typically: 10, 15, 20, 25, or 30 years

IMPORTANT:
- Do NOT re-ask a question that's already shown in the UI card.
- When a questionnaire question is active, IMMEDIATELY call save_application_answer when the user responds.
- If the customer wants to pause: use cancel_application with a descriptive reason.
- Use get_objection_strategy if the customer raises concerns during the application.

TOOL RULES: Always use tools rather than describing actions. Speak in PAST TENSE for completed actions. Don't ask permission to use tools.`,
      uiAction: null,
      transitions: [
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'application_complete',
          label: 'All underwriting questions answered',
          priority: 0,
          toStepCode: 'generate_quote',
        },
      ],
    },
    {
      code: 'generate_quote',
      name: 'Generate Quote',
      orderIndex: 8,
      type: 'AUTO',
      autoTool: 'generate_quote',
      allowedTools: ['generate_quote'],
      agentInstructions: `Generate the life insurance quote. Call generate_quote — it calculates the premium from the completed underwriting application.

Build excitement: "Great news — your application is complete! Let me generate your personalized quote now."

TOOL RULES: Always use tools rather than describing actions. Speak in PAST TENSE for completed actions ("I've generated your quote").`,
      uiAction: null,
      transitions: [
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'quote_generated',
          label: 'Quote generated successfully',
          priority: 0,
          toStepCode: 'quote_review',
        },
      ],
    },
    {
      code: 'quote_review',
      name: 'Review Quote',
      orderIndex: 9,
      type: 'INTERACTIVE',
      autoTool: null,
      allowedTools: ['get_quote_details', 'accept_quote', 'modify_quote'],
      agentInstructions: `Present the life insurance quote to the customer clearly and persuasively.

HOW TO PRESENT THE QUOTE:
1. Show the key numbers: monthly premium, annual premium (highlight savings if annual is cheaper), coverage amount, policy duration.
2. Explain what's covered — connect the coverage back to needs they expressed earlier.
3. If there are add-ons or riders, explain what each one protects against and why it matters for their situation.
4. Use get_quote_details if the customer asks for more information.
5. If they want changes (different coverage, duration, add/remove riders): use modify_quote.
6. If they accept: use accept_quote with their confirmation.

HANDLING THIS STAGE:
- Don't rush. Let the customer ask questions and process the information.
- Use get_objection_strategy if they raise concerns about price, coverage, or value.
- If they need time to think, that's okay — offer to save their quote and let them come back.
- Relate everything back to their specific situation: "Based on what you told me about your family..."

TOOL RULES: Always use tools rather than describing actions. Speak in PAST TENSE for completed actions. Don't ask permission to use tools.`,
      uiAction: null,
      transitions: [
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'policy_issued',
          label: 'Quote accepted, policy issued',
          priority: 0,
          toStepCode: 'completed',
        },
        {
          conditionType: 'TOOL_RESULT',
          conditionValue: 'quote_modified',
          label: 'Customer wants changes',
          priority: 0,
          toStepCode: 'application_fill',
        },
      ],
    },
    {
      code: 'completed',
      name: 'Completed',
      orderIndex: 10,
      type: 'AUTO',
      autoTool: null,
      allowedTools: [],
      agentInstructions: `Congratulations — the life insurance policy has been issued! This is a big moment for the customer.

WHAT TO TELL THEM:
- Policy number and coverage start date
- Brief summary of what's covered and for how long
- Monthly/annual premium reminder
- What to do if they need to file a claim or make changes
- Remind them they can come back anytime for questions or to explore other coverage types

TONE: Celebrate this achievement with them. They've made an important decision for their family's protection. Be warm, congratulatory, and reassuring.

This is a terminal step — the workflow is complete.`,
      uiAction: null,
      transitions: [],
    },
  ],
}

// ============================================
// Seed Logic
// ============================================

async function seedWorkflow(prisma: PrismaClient, def: WorkflowDef): Promise<void> {
  // Delete existing transitions, steps, then upsert workflow
  const existing = await prisma.workflow.findUnique({
    where: { code: def.code },
    include: { steps: true },
  })

  if (existing) {
    // Delete transitions first (they reference steps)
    for (const step of existing.steps) {
      await prisma.stepTransition.deleteMany({ where: { fromStepId: step.id } })
      await prisma.stepTransition.deleteMany({ where: { toStepId: step.id } })
    }
    // Delete steps
    await prisma.workflowStep.deleteMany({ where: { workflowId: existing.id } })
    console.log(`    Cleaned existing workflow "${def.name}" for re-seed`)
  }

  // Upsert workflow
  const workflow = await prisma.workflow.upsert({
    where: { code: def.code },
    update: {
      name: def.name,
      description: def.description,
      isActive: def.isActive,
      version: def.version,
    },
    create: {
      code: def.code,
      name: def.name,
      description: def.description,
      isActive: def.isActive,
      version: def.version,
    },
  })

  console.log(`    Workflow "${workflow.name}" upserted (id: ${workflow.id})`)

  // Create all steps first (need IDs for transitions)
  const stepMap = new Map<string, string>() // code → id

  for (const stepDef of def.steps) {
    const step = await prisma.workflowStep.create({
      data: {
        workflowId: workflow.id,
        code: stepDef.code,
        name: stepDef.name,
        type: stepDef.type,
        orderIndex: stepDef.orderIndex,
        autoTool: stepDef.autoTool,
        allowedTools: stepDef.allowedTools,
        agentInstructions: stepDef.agentInstructions,
        uiAction: stepDef.uiAction,
      },
    })
    stepMap.set(stepDef.code, step.id)
  }
  console.log(`    ${def.steps.length} steps created`)

  // Create transitions
  let transitionCount = 0
  for (const stepDef of def.steps) {
    const fromStepId = stepMap.get(stepDef.code)!

    for (const t of stepDef.transitions) {
      const toStepId = stepMap.get(t.toStepCode)
      if (!toStepId) {
        console.error(`    ERROR: Transition target "${t.toStepCode}" not found in workflow`)
        continue
      }

      await prisma.stepTransition.create({
        data: {
          fromStepId,
          toStepId,
          conditionType: t.conditionType,
          conditionValue: t.conditionValue,
          label: t.label,
          priority: t.priority,
        },
      })
      transitionCount++
    }
  }
  console.log(`    ${transitionCount} transitions created`)
}

// ============================================
// Exported entry point
// ============================================

export async function seedWorkflows(prisma: PrismaClient) {
  console.log('  Seeding workflows...')

  await seedWorkflow(prisma, PRODUCT_DISCOVERY)
  await seedWorkflow(prisma, LIFE_INSURANCE_PURCHASE)

  console.log('  Workflows seed complete.')
}
