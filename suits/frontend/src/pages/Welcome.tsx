import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import SplashScreen from '@/components/splash/SplashScreen'
import OnboardingVideo from '@/components/onboarding/OnboardingVideo'
import OnboardingFlow from '@/components/onboarding/OnboardingFlow'
import { useUser } from '@/context/UserContext'

type Phase = 'splash' | 'video' | 'onboarding' | 'done'

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
    setPhase('video')
  }

  const handleVideoComplete = () => {
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
    <div className="fixed inset-0 bg-surface">
      <AnimatePresence mode="wait">
        {phase === 'splash' && (
          <SplashScreen key="splash" onContinue={handleNameSubmit} />
        )}

        {phase === 'video' && (
          <OnboardingVideo key="video" onComplete={handleVideoComplete} />
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
