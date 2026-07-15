import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { cookies } from 'next/headers'

export async function POST() {
  const cookieStore = await cookies()
  const existingSession = cookieStore.get('zeno_session')

  if (existingSession?.value) {
    const customer = await prisma.customer.findUnique({
      where: { id: existingSession.value },
    })
    // B3.5: a merged shell points at its canonical customer — follow the
    // pointer and rebind the cookie so the session continues on the account
    // the customer proved ownership of. (T4.D5's opaque-session transport is
    // still the raw id; consumed here, not implemented — see handoff.)
    if (customer?.mergedIntoId) {
      const canonical = await prisma.customer.findUnique({ where: { id: customer.mergedIntoId } })
      if (canonical) {
        const response = NextResponse.json({ customerId: canonical.id, isNew: false })
        response.cookies.set('zeno_session', canonical.id, {
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 2592000,
          path: '/',
          secure: process.env.NODE_ENV === 'production',
        })
        return response
      }
    }
    if (customer) {
      return NextResponse.json({ customerId: customer.id, isNew: false })
    }
  }

  // Create anonymous customer
  const customer = await prisma.customer.create({
    data: { isAnonymous: true, language: 'ro' },
  })

  const response = NextResponse.json({ customerId: customer.id, isNew: true })
  response.cookies.set('zeno_session', customer.id, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 2592000, // 30 days
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}
