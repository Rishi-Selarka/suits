import { motion } from 'framer-motion'
import AppLayout from '@/components/layout/AppLayout'
import { easeOutExpo } from '@/lib/motion'

export default function Home() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, ease: easeOutExpo }}
      className="h-screen"
    >
      <AppLayout />
    </motion.div>
  )
}
