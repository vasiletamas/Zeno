'use client'

import { useMemo } from 'react'

const PARTICLE_COUNT = 20
const COLORS = ['bg-sand', 'bg-sage']

interface Particle {
  id: number
  color: string
  left: number
  delay: number
  duration: number
  drift: number
}

export function Confetti() {
  const particles = useMemo<Particle[]>(() => {
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      id: i,
      color: COLORS[i % COLORS.length],
      left: Math.round((i / PARTICLE_COUNT) * 100 + Math.random() * 5),
      delay: Math.round(Math.random() * 800),
      duration: 1800 + Math.round(Math.random() * 600),
      drift: Math.round((Math.random() - 0.5) * 40),
    }))
  }, [])

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none motion-reduce:hidden"
      aria-hidden="true"
    >
      {particles.map((p) => (
        <span
          key={p.id}
          className={`absolute w-2 h-2 rounded-full ${p.color}`}
          style={{
            left: `${p.left}%`,
            top: '-10px',
            animation: `confetti-fall ${p.duration}ms ease-out ${p.delay}ms forwards`,
            ['--confetti-drift' as string]: `${p.drift}px`,
          }}
        />
      ))}
    </div>
  )
}
