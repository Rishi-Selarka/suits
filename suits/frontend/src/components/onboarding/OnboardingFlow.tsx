import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, ArrowLeft, MapPin, Briefcase, Target } from 'lucide-react'
import {
  Scale,
  Building2,
  UserRound,
  PenTool,
  GraduationCap,
  FileSearch,
  ShieldAlert,
  ScrollText,
  Handshake,
  BookOpen,
} from 'lucide-react'
import SelectCard from './SelectCard'
import { easeOutExpo } from '@/lib/motion'

interface OnboardingFlowProps {
  userName: string
  onComplete: (data: { location: string; profession: string; purpose: string }) => void
}

const LOCATIONS = [
  { id: 'india', label: 'India', emoji: '🇮🇳' },
  { id: 'usa', label: 'United States', emoji: '🇺🇸' },
  { id: 'uk', label: 'United Kingdom', emoji: '🇬🇧' },
  { id: 'canada', label: 'Canada', emoji: '🇨🇦' },
  { id: 'uae', label: 'UAE', emoji: '🇦🇪' },
  { id: 'singapore', label: 'Singapore', emoji: '🇸🇬' },
]

const PROFESSIONS = [
  { id: 'lawyer', label: 'Lawyer', sublabel: 'Legal Professional', icon: Scale },
  { id: 'business', label: 'Business Owner', sublabel: 'Entrepreneur', icon: Building2 },
  { id: 'corporate', label: 'Corporate', sublabel: 'Executive / Manager', icon: UserRound },
  { id: 'freelancer', label: 'Freelancer', sublabel: 'Consultant / Creator', icon: PenTool },
  { id: 'student', label: 'Student', sublabel: 'Academic / Researcher', icon: GraduationCap },
]

const PURPOSES = [
  { id: 'review', label: 'Contract Review', sublabel: 'Analyze & understand', icon: FileSearch },
  { id: 'risk', label: 'Risk Assessment', sublabel: 'Identify legal risks', icon: ShieldAlert },
  { id: 'compliance', label: 'Compliance', sublabel: 'Regulatory checks', icon: ScrollText },
  { id: 'negotiation', label: 'Negotiation', sublabel: 'Strategy & leverage', icon: Handshake },
  { id: 'research', label: 'Legal Research', sublabel: 'Case law & statutes', icon: BookOpen },
]

interface StepConfig {
  key: string
  title: string
  subtitle: string
  icon: typeof MapPin
  options: typeof LOCATIONS | typeof PROFESSIONS | typeof PURPOSES
  columns: number
}

const STEPS: StepConfig[] = [
  {
    key: 'location',
    title: 'Where are you based?',
    subtitle: 'This helps us tailor jurisdiction-specific insights.',
    icon: MapPin,
    options: LOCATIONS,
    columns: 3,
  },
  {
    key: 'profession',
    title: "What's your profession?",
    subtitle: 'We adapt the depth of analysis to your expertise.',
    icon: Briefcase,
    options: PROFESSIONS,
    columns: 5,
  },
  {
    key: 'purpose',
    title: 'What brings you to Suits?',
    subtitle: "We'll prioritize features that matter most to you.",
    icon: Target,
    options: PURPOSES,
    columns: 5,
  },
]

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
}

export default function OnboardingFlow({ userName, onComplete }: OnboardingFlowProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const [selections, setSelections] = useState<Record<string, string>>({
    location: '',
    profession: '',
    purpose: '',
  })
  const [exiting, setExiting] = useState(false)

  const step = STEPS[stepIndex]
  const isLast = stepIndex === STEPS.length - 1
  const canProceed = selections[step.key] !== ''

  const handleSelect = (id: string) => {
    setSelections(prev => ({ ...prev, [step.key]: id }))
  }

  const handleNext = () => {
    if (!canProceed) return
    if (isLast) {
      setExiting(true)
      setTimeout(() => {
        onComplete({
          location: selections.location,
          profession: selections.profession,
          purpose: selections.purpose,
        })
      }, 600)
      return
    }
    setDirection(1)
    setStepIndex(prev => prev + 1)
  }

  const handleBack = () => {
    if (stepIndex === 0) return
    setDirection(-1)
    setStepIndex(prev => prev - 1)
  }

  return (
    <motion.div
      className="fixed inset-0 bg-cream flex items-center justify-center"
      animate={exiting ? { opacity: 0, scale: 1.05 } : { opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: easeOutExpo }}
    >
      <div className="w-full max-w-2xl px-8 relative z-10">
        {/* Progress bar */}
        <motion.div
          className="mb-12"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-neutral-400 text-sm">
              Step {stepIndex + 1} of {STEPS.length}
            </span>
            <span className="text-neutral-500 text-sm">
              Hi, {userName}
            </span>
          </div>
          <div className="h-1 bg-cream-200 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-neutral-900 rounded-full"
              animate={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
              transition={{ duration: 0.5, ease: easeOutExpo }}
            />
          </div>
        </motion.div>

        {/* Step content */}
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step.key}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.4, ease: easeOutExpo }}
          >
            {/* Header */}
            <div className="mb-10">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-neutral-900 flex items-center justify-center">
                  <step.icon className="w-4 h-4 text-cream" />
                </div>
                <h2 className="text-3xl font-light text-neutral-900">
                  {step.title}
                </h2>
              </div>
              <p className="text-neutral-500 ml-12">{step.subtitle}</p>
            </div>

            {/* Options grid */}
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${Math.min(step.columns, step.options.length)}, 1fr)`,
              }}
            >
              {step.options.map((option, i) => (
                <SelectCard
                  key={option.id}
                  label={option.label}
                  sublabel={'sublabel' in option ? option.sublabel : undefined}
                  icon={'icon' in option ? option.icon : undefined}
                  emoji={'emoji' in option ? option.emoji : undefined}
                  selected={selections[step.key] === option.id}
                  onClick={() => handleSelect(option.id)}
                  index={i}
                />
              ))}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <motion.div
          className="flex items-center justify-between mt-12"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          <motion.button
            onClick={handleBack}
            className="flex items-center gap-2 text-neutral-400 hover:text-neutral-900 transition-colors disabled:opacity-0"
            disabled={stepIndex === 0}
            whileHover={{ x: -2 }}
            whileTap={{ scale: 0.97 }}
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </motion.button>

          <motion.button
            onClick={handleNext}
            disabled={!canProceed}
            className="flex items-center gap-3 px-8 py-3 rounded-xl bg-neutral-900 text-cream font-medium text-sm hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
            whileHover={canProceed ? { scale: 1.02 } : {}}
            whileTap={canProceed ? { scale: 0.98 } : {}}
          >
            <span>{isLast ? 'Get Started' : 'Continue'}</span>
            <ArrowRight className="w-4 h-4" />
          </motion.button>
        </motion.div>
      </div>
    </motion.div>
  )
}
