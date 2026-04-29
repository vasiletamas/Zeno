/**
 * Playwright Demo: Drive a full scripted conversation in a visible browser.
 *
 * Connects to an already-running playwright-cli session and automates
 * the price-objection-conversion scenario turn by turn, with pauses
 * so the human can watch.
 */

import 'dotenv/config'
import { chromium } from 'playwright'
import { DEFAULT_ANSWERS } from '../lib/simulation/personas'

const BASE_URL = 'http://localhost:3000'
const TURN_PAUSE_MS = 2000   // pause between turns so human can read

async function main() {
  const browser = await chromium.launch({ headless: false, slowMo: 50 })
  const context = await browser.newContext()
  const page = await context.newPage()

  console.log('Opening landing page...')
  await page.goto(BASE_URL)
  await page.waitForTimeout(TURN_PAUSE_MS)

  console.log('Clicking chat CTA...')
  await page.getByRole('link', { name: 'Află în 3 minute' }).click()
  await page.waitForURL('**/chat/**', { timeout: 15000 })
  await page.waitForTimeout(TURN_PAUSE_MS)

  // ---- Conversation script (Elena - price-objector) ----
  const messages = [
    'Buna, vreau sa vad cat costa o asigurare de viata. Am 37 de ani, profesoara, 1 copil.',
    'Pentru familie. Nu am credit. As vrea undeva la 200.000 lei. Dar ma sperie costul, nu vreau ceva prea scump.',
    'E cam scump... nu aveti ceva mai ieftin?',
    'Hmm, tot mi se pare mult. Chiar merita?',
    'OK, hai sa vedem varianta standard, nivelul 1. Cea mai ieftina.',
  ]

  let turn = 0
  for (const msg of messages) {
    turn++
    console.log(`\n--- Turn ${turn}: Elena ---`)
    console.log(`> ${msg}`)

    // Wait for input to be enabled (previous response finished)
    await waitForInputReady(page)

    const input = page.getByRole('textbox', { name: 'Message input' })
    await input.fill(msg)
    await input.press('Enter')

    // Wait for Zeno's response to finish
    await waitForInputReady(page, 120000)

    // Extract last assistant message text for logging
    const lastAssistant = await page.evaluate(() => {
      const bubbles = document.querySelectorAll('[class*="assistant"], [data-role="assistant"]')
      if (bubbles.length === 0) return '(no assistant bubble found)'
      return (bubbles[bubbles.length - 1].textContent || '').slice(0, 200)
    })
    console.log(`< Zeno: ${lastAssistant}`)

    await page.waitForTimeout(TURN_PAUSE_MS)

    // Handle UI actions: product cards, quote, payment
    const handled = await handleUIActions(page)
    if (handled === 'done') {
      console.log('\n*** Conversation complete ***')
      break
    }
  }

  // After script messages, handle any remaining questionnaire turns deterministically
  console.log('\n--- Entering deterministic answer phase ---')
  let safety = 40
  while (safety-- > 0) {
    await page.waitForTimeout(1500)

    const action = await detectUIAction(page)
    if (!action) break

    console.log(`UI action: ${action.type}`)

    if (action.type === 'show_question') {
      const code = action.code
      const answer = code ? DEFAULT_ANSWERS[code] : null
      if (answer) {
        console.log(`> Auto-answer (${code}): ${answer}`)
        await waitForInputReady(page)
        const input = page.getByRole('textbox', { name: 'Message input' })
        await input.fill(answer)
        await input.press('Enter')
        await waitForInputReady(page, 60000)
      } else {
        console.log(`No auto-answer for ${code}, sending 'da'`)
        await waitForInputReady(page)
        const input = page.getByRole('textbox', { name: 'Message input' })
        await input.fill('da')
        await input.press('Enter')
        await waitForInputReady(page, 60000)
      }
    } else if (action.type === 'show_product_cards') {
      console.log('> Selecting Standard / Nivel 1 (cheapest for Elena)')
      await waitForInputReady(page)
      const input = page.getByRole('textbox', { name: 'Message input' })
      await input.fill('Vreau Standard Nivelul 1')
      await input.press('Enter')
      await waitForInputReady(page, 60000)
    } else if (action.type === 'show_quote') {
      console.log('> Accepting quote')
      await waitForInputReady(page)
      const input = page.getByRole('textbox', { name: 'Message input' })
      await input.fill('Da, accept oferta')
      await input.press('Enter')
      await waitForInputReady(page, 60000)
    } else if (action.type === 'show_payment') {
      console.log('> Simulating payment')
      await waitForInputReady(page)
      const input = page.getByRole('textbox', { name: 'Message input' })
      await input.fill('Simulez plata')
      await input.press('Enter')
      await waitForInputReady(page, 60000)
    } else if (action.type === 'show_payment_success' || action.type === 'show_policy_issued') {
      console.log('\n*** SUCCESS: Policy issued ***')
      break
    }
  }

  console.log('\nKeeping browser open for 30 seconds so you can review...')
  await page.waitForTimeout(30000)
  await browser.close()
}

async function waitForInputReady(page: import('playwright').Page, timeout = 90000): Promise<void> {
  await page.waitForFunction(
    () => {
      const input = document.querySelector('textbox, input[placeholder*="mesaj"], textarea[placeholder*="mesaj"]')
      const el = input as HTMLInputElement | HTMLTextAreaElement | null
      return el !== null && !el.disabled
    },
    { timeout },
  ).catch(() => {
    // Fall back: just wait for the send button to not be disabled
  })
  // Additional check via Playwright locator
  const input = page.getByRole('textbox', { name: 'Message input' })
  await input.waitFor({ state: 'visible', timeout })
  const maxTries = 120
  for (let i = 0; i < maxTries; i++) {
    const disabled = await input.isDisabled()
    if (!disabled) return
    await page.waitForTimeout(1000)
  }
}

async function detectUIAction(page: import('playwright').Page): Promise<{ type: string; code?: string } | null> {
  return await page.evaluate(() => {
    // Look for common UI action markers in the DOM
    const body = document.body.innerHTML

    if (body.includes('show_payment_success') || document.querySelector('[data-action="show_payment_success"]')) {
      return { type: 'show_payment_success' }
    }
    if (body.includes('show_policy_issued') || document.querySelector('[data-action="show_policy_issued"]')) {
      return { type: 'show_policy_issued' }
    }
    if (document.querySelector('[data-action="show_product_cards"], .product-cards')) {
      return { type: 'show_product_cards' }
    }
    if (document.querySelector('[data-action="show_quote"], .quote-card')) {
      return { type: 'show_quote' }
    }
    if (document.querySelector('[data-action="show_payment"], .payment-form')) {
      return { type: 'show_payment' }
    }
    // Check for active question — look for question code
    const questionEl = document.querySelector('[data-question-code]')
    if (questionEl) {
      return { type: 'show_question', code: questionEl.getAttribute('data-question-code') ?? undefined }
    }
    return null
  })
}

async function handleUIActions(page: import('playwright').Page): Promise<'continue' | 'done'> {
  const action = await detectUIAction(page)
  if (!action) return 'continue'
  if (action.type === 'show_payment_success' || action.type === 'show_policy_issued') return 'done'
  return 'continue'
}

main().catch(err => {
  console.error('Demo error:', err)
  process.exit(1)
})
