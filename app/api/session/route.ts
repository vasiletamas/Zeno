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
