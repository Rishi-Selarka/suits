import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import SplashScreen from '@/components/splash/SplashScreen'
import OnboardingFlow from '@/components/onboarding/OnboardingFlow'
import { useUser } from '@/context/UserContext'

type Phase = 'splash' | 'onboarding'

interface WelcomeProps {
  onComplete: () => void
}

export default function Welcome({ onComplete }: WelcomeProps) {
  const { setUser } = useUser()
  const [phase, setPhase] = useState<Phase>('splash')
  const [userName, setUserName] = useState('')

  const handleNameSubmit = (name: string) => {
    setUserName(name)
    setUser({ name })
    setPhase('onboarding')
  }

  const handleOnboardingComplete = (data: {
    location: string
    profession: string
    purpose: string
  }) => {
    setUser({
      ...data,
      onboarded: true,
    })
    onComplete()
  }

  return (
    <div className="fixed inset-0 bg-cream">
      <AnimatePresence mode="wait">
        {phase === 'splash' && (
          <SplashScreen key="splash" onContinue={handleNameSubmit} />
        )}

        {phase === 'onboarding' && (
          <OnboardingFlow
            key="onboarding"
            userName={userName}
            onComplete={handleOnboardingComplete}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
