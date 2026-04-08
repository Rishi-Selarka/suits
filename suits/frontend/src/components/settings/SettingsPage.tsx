import { useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Camera, Check, MapPin, Briefcase, Target, User, LogOut } from 'lucide-react'
import { useUser } from '@/context/UserContext'
import { cn } from '@/lib/utils'
import { easeOutExpo } from '@/lib/motion'

const LOCATIONS = [
  { id: 'india', label: 'India', emoji: '🇮🇳' },
  { id: 'usa', label: 'United States', emoji: '🇺🇸' },
  { id: 'uk', label: 'United Kingdom', emoji: '🇬🇧' },
  { id: 'canada', label: 'Canada', emoji: '🇨🇦' },
  { id: 'uae', label: 'UAE', emoji: '🇦🇪' },
  { id: 'singapore', label: 'Singapore', emoji: '🇸🇬' },
]

const PROFESSIONS = [
  { id: 'lawyer', label: 'Lawyer' },
  { id: 'business', label: 'Business Owner' },
  { id: 'corporate', label: 'Corporate' },
  { id: 'freelancer', label: 'Freelancer' },
  { id: 'student', label: 'Student' },
]

const PURPOSES = [
  { id: 'review', label: 'Contract Review' },
  { id: 'risk', label: 'Risk Assessment' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'research', label: 'Legal Research' },
]

export default function SettingsPage() {
  const { user, setUser, resetUser } = useUser()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(user.name)
  const [location, setLocation] = useState(user.location)
  const [profession, setProfession] = useState(user.profession)
  const [purpose, setPurpose] = useState(user.purpose)
  const [saved, setSaved] = useState(false)

  const hasChanges =
    name !== user.name ||
    location !== user.location ||
    profession !== user.profession ||
    purpose !== user.purpose

  const handleAvatarUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      if (file.size > 2 * 1024 * 1024) return // 2MB max

      const reader = new FileReader()
      reader.onload = () => {
        setUser({ avatar: reader.result as string })
      }
      reader.readAsDataURL(file)
      e.target.value = ''
    },
    [setUser],
  )

  const handleSave = () => {
    setUser({ name, location, profession, purpose })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex-1 h-screen overflow-y-auto bg-cream">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: easeOutExpo }}
        >
          <h1 className="text-2xl font-semibold text-surface-200 mb-1">Settings</h1>
          <p className="text-sm text-cream-400 mb-10">Manage your profile and preferences</p>

          {/* ── Avatar ── */}
          <div className="flex items-center gap-5 mb-10">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="relative group"
            >
              <div className="w-20 h-20 rounded-full overflow-hidden bg-gradient-to-br from-suits-400 to-suits-600 flex items-center justify-center shrink-0">
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt="Profile"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-white text-2xl font-semibold">
                    {user.name?.[0]?.toUpperCase() || 'U'}
                  </span>
                )}
              </div>
              <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="w-5 h-5 text-white" />
              </div>
            </button>
            <div>
              <p className="text-sm font-medium text-surface-200">{user.name || 'User'}</p>
              <p className="text-xs text-cream-400 capitalize">{user.profession || 'Member'}</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-xs text-suits-600 hover:text-suits-500 mt-1 transition-colors"
              >
                Upload photo
              </button>
            </div>
          </div>

          {/* ── Name ── */}
          <Section icon={User} title="Display Name">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              className="w-full px-4 py-2.5 rounded-xl border border-cream-300 bg-cream-100 text-surface-200 text-sm focus:outline-none focus:border-suits-500 focus:ring-1 focus:ring-suits-500/20 transition-all placeholder:text-cream-400"
            />
          </Section>

          {/* ── Location ── */}
          <Section icon={MapPin} title="Location">
            <div className="grid grid-cols-3 gap-2">
              {LOCATIONS.map(loc => (
                <OptionButton
                  key={loc.id}
                  selected={location === loc.id}
                  onClick={() => setLocation(loc.id)}
                >
                  <span>{loc.emoji}</span>
                  <span className="text-sm">{loc.label}</span>
                </OptionButton>
              ))}
            </div>
          </Section>

          {/* ── Profession ── */}
          <Section icon={Briefcase} title="Profession">
            <div className="grid grid-cols-3 gap-2">
              {PROFESSIONS.map(prof => (
                <OptionButton
                  key={prof.id}
                  selected={profession === prof.id}
                  onClick={() => setProfession(prof.id)}
                >
                  <span className="text-sm">{prof.label}</span>
                </OptionButton>
              ))}
            </div>
          </Section>

          {/* ── Purpose ── */}
          <Section icon={Target} title="Primary Use">
            <div className="grid grid-cols-3 gap-2">
              {PURPOSES.map(p => (
                <OptionButton
                  key={p.id}
                  selected={purpose === p.id}
                  onClick={() => setPurpose(p.id)}
                >
                  <span className="text-sm">{p.label}</span>
                </OptionButton>
              ))}
            </div>
          </Section>

          {/* ── Save ── */}
          <div className="flex items-center gap-3 mt-10 pt-6 border-t border-cream-200">
            <motion.button
              onClick={handleSave}
              disabled={!hasChanges}
              className={cn(
                'flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium transition-all duration-300',
                saved
                  ? 'bg-green-500/10 text-green-600 border border-green-500/20'
                  : hasChanges
                    ? 'bg-suits-600 text-white hover:bg-suits-500'
                    : 'bg-cream-200 text-cream-400 cursor-not-allowed',
              )}
              whileHover={hasChanges ? { scale: 1.02 } : {}}
              whileTap={hasChanges ? { scale: 0.98 } : {}}
            >
              {saved ? (
                <>
                  <Check className="w-4 h-4" />
                  Saved
                </>
              ) : (
                'Save Changes'
              )}
            </motion.button>
            {hasChanges && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs text-cream-400"
              >
                You have unsaved changes
              </motion.span>
            )}
          </div>

          {/* ── Logout ── */}
          <div className="mt-10 pt-6 border-t border-cream-200">
            <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-3">Account</p>
            <p className="text-sm text-cream-400 mb-4">
              Log out and return to the welcome screen. Your data will be cleared.
            </p>
            <motion.button
              onClick={resetUser}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 hover:border-red-300 transition-all duration-200"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <LogOut className="w-4 h-4" />
              Logout
            </motion.button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof User
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-cream-400" />
        <h3 className="text-xs font-medium text-cream-400 uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function OptionButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-left transition-all duration-200',
        selected
          ? 'border-suits-500 bg-suits-500/5 text-suits-700'
          : 'border-cream-300 bg-cream-100 text-surface-300 hover:border-cream-400 hover:bg-cream-200/60',
      )}
    >
      {children}
    </button>
  )
}
