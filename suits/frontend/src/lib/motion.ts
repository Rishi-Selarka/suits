import type { Variants } from 'framer-motion'

// ── Shared transition presets ──

export const spring = {
  type: 'spring' as const,
  stiffness: 100,
  damping: 15,
  mass: 0.8,
}

export const springSnappy = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 25,
  mass: 0.5,
}

export const springGentle = {
  type: 'spring' as const,
  stiffness: 60,
  damping: 20,
  mass: 1,
}

export const easeOutExpo = [0.16, 1, 0.3, 1] as const

// ── Reusable variants ──

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.6 } },
}

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: easeOutExpo },
  },
}

export const fadeInDown: Variants = {
  hidden: { opacity: 0, y: -20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: easeOutExpo },
  },
}

export const fadeInScale: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: easeOutExpo },
  },
}

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, ease: easeOutExpo },
  },
}

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, ease: easeOutExpo },
  },
}

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
}

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: easeOutExpo },
  },
}

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: spring,
  },
}

export const pipelineNode: Variants = {
  idle: {
    scale: 1,
    boxShadow: '0 0 0px rgba(92, 124, 250, 0)',
  },
  running: {
    scale: [1, 1.05, 1],
    boxShadow: [
      '0 0 0px rgba(92, 124, 250, 0)',
      '0 0 30px rgba(92, 124, 250, 0.4)',
      '0 0 0px rgba(92, 124, 250, 0)',
    ],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
  complete: {
    scale: 1,
    boxShadow: '0 0 20px rgba(34, 197, 94, 0.3)',
    transition: spring,
  },
  error: {
    scale: 1,
    boxShadow: '0 0 20px rgba(239, 68, 68, 0.3)',
    transition: spring,
  },
}

// ── Page transitions ──

export const pageTransition: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: easeOutExpo },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.3 },
  },
}
