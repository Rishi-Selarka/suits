import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, ExternalLink, ArrowLeft, Search, X } from 'lucide-react'
import { staggerContainer, staggerItem } from '@/lib/motion'

const RESOURCES = [
  { category: 'Core Indian Contract Law', items: [
    { title: 'Indian Contract Act, 1872', desc: 'Foundation of contract law — formation, consideration, performance, breach', url: 'https://www.indiacode.nic.in/handle/123456789/2187' },
    { title: 'Specific Relief Act, 1963', desc: 'Equitable remedies and injunctive relief for breach of contract', url: 'https://www.indiacode.nic.in/handle/123456789/1601' },
    { title: 'Sale of Goods Act, 1930', desc: 'Conditions, warranties, and risk transfer in commercial sales', url: 'https://www.indiacode.nic.in/handle/123456789/2390' },
    { title: 'Indian Stamp Act, 1899', desc: 'State-wise stamp duty applicable to agreements and deeds', url: 'https://www.indiacode.nic.in/handle/123456789/2263' },
    { title: 'Indian Registration Act, 1908', desc: 'Documents that must be registered to be legally enforceable', url: 'https://www.indiacode.nic.in/handle/123456789/2440' },
    { title: 'Negotiable Instruments Act, 1881 (Sec 138)', desc: 'Liability for dishonoured cheques and recovery procedure', url: 'https://www.indiacode.nic.in/handle/123456789/2189' },
  ]},
  { category: 'Employment & Service Agreements', items: [
    { title: 'Shops & Establishments Acts (state-wise)', desc: 'Working hours, leave, termination — state-level employment rules', url: 'https://labour.gov.in/labour-law-reforms' },
    { title: 'Industrial Disputes Act, 1947', desc: 'Workman protections, retrenchment compensation, dispute machinery', url: 'https://www.indiacode.nic.in/handle/123456789/1445' },
    { title: 'Payment of Gratuity Act, 1972', desc: 'Statutory gratuity entitlement after 5 years of continuous service', url: 'https://www.indiacode.nic.in/handle/123456789/1622' },
    { title: 'Code on Wages, 2019', desc: 'Minimum wages, equal remuneration, payment timelines', url: 'https://labour.gov.in/sites/default/files/the_code_on_wages_2019_no._29_of_2019.pdf' },
    { title: 'Code on Social Security, 2020', desc: 'EPF, ESI, maternity, and gig-worker social security', url: 'https://labour.gov.in/sites/default/files/SS_Code_Gazette.pdf' },
    { title: 'Sexual Harassment of Women at Workplace Act, 2013 (POSH)', desc: 'Mandatory ICC and complaint redressal for every employer', url: 'https://www.indiacode.nic.in/handle/123456789/2104' },
  ]},
  { category: 'Tenancy, Property & Real Estate', items: [
    { title: 'Model Tenancy Act, 2021', desc: 'Centre-recommended framework for fair landlord–tenant relationships', url: 'https://mohua.gov.in/upload/uploadfiles/files/Model%20Tenancy%20Act%20English%2002_06_2021.pdf' },
    { title: 'Transfer of Property Act, 1882', desc: 'Lease, mortgage, gift and sale of immovable property', url: 'https://www.indiacode.nic.in/handle/123456789/2338' },
    { title: 'Real Estate (Regulation and Development) Act, 2016 (RERA)', desc: 'Buyer protections and developer obligations', url: 'https://www.indiacode.nic.in/handle/123456789/2249' },
    { title: 'State Rent Control Acts', desc: 'State-specific limits on rent increases and eviction grounds', url: 'https://legislative.gov.in/' },
  ]},
  { category: 'Consumer & Data Protection', items: [
    { title: 'Consumer Protection Act, 2019', desc: 'Unfair contract terms, e-commerce rules, product liability', url: 'https://consumeraffairs.nic.in/sites/default/files/CPA2019.pdf' },
    { title: 'Digital Personal Data Protection Act, 2023 (DPDP)', desc: 'Consent, purpose limitation, and data principal rights', url: 'https://www.meity.gov.in/writereaddata/files/Digital%20Personal%20Data%20Protection%20Act%202023.pdf' },
    { title: 'Information Technology Act, 2000', desc: 'Electronic signatures, intermediary liability, cybercrime', url: 'https://www.indiacode.nic.in/handle/123456789/1999' },
  ]},
  { category: 'Companies, Tax & Compliance', items: [
    { title: 'Companies Act, 2013', desc: 'Corporate governance, director duties, related-party transactions', url: 'https://www.mca.gov.in/content/mca/global/en/acts-rules/ebooks/acts.html' },
    { title: 'LLP Act, 2008', desc: 'Limited Liability Partnership formation and compliance', url: 'https://www.indiacode.nic.in/handle/123456789/2009' },
    { title: 'CGST Act, 2017', desc: 'GST applicability on contractual supplies and indemnities', url: 'https://cbic-gst.gov.in/CGST-bill-e.html' },
    { title: 'Income Tax Act, 1961', desc: 'TDS obligations on professional fees, rent, and contractor payments', url: 'https://incometaxindia.gov.in/Pages/acts/income-tax-act.aspx' },
  ]},
  { category: 'Dispute Resolution & Arbitration', items: [
    { title: 'Arbitration and Conciliation Act, 1996', desc: 'Domestic and international arbitration, seat vs venue, enforcement', url: 'https://www.indiacode.nic.in/handle/123456789/1978' },
    { title: 'Mediation Act, 2023', desc: 'Pre-litigation mediation framework introduced for civil/commercial disputes', url: 'https://prsindia.org/files/bills_acts/acts_parliament/2023/THE_MEDIATION_ACT_2023.pdf' },
    { title: 'Commercial Courts Act, 2015', desc: 'Fast-track adjudication of high-value commercial disputes', url: 'https://www.indiacode.nic.in/handle/123456789/2143' },
    { title: 'Code of Civil Procedure, 1908', desc: 'Procedure for civil suits, jurisdiction, and execution of decrees', url: 'https://www.indiacode.nic.in/handle/123456789/2191' },
  ]},
  { category: 'Frequently-Cited Sections', items: [
    { title: 'Sec 23 — Unlawful Consideration', desc: 'Agreements opposed to public policy are void', url: 'https://www.indiacode.nic.in/show-data?actid=AC_CEN_3_20_00035_187209_1523340333624&sectionId=30777&sectionno=23' },
    { title: 'Sec 27 — Restraint of Trade', desc: 'Non-compete during employment is enforceable; post-employment generally void', url: 'https://www.indiacode.nic.in/show-data?actid=AC_CEN_3_20_00035_187209_1523340333624&sectionId=30781&sectionno=27' },
    { title: 'Sec 56 — Frustration / Impossibility', desc: 'Doctrine of supervening impossibility (force majeure)', url: 'https://www.indiacode.nic.in/show-data?actid=AC_CEN_3_20_00035_187209_1523340333624&sectionId=30810&sectionno=56' },
    { title: 'Sec 73 — Damages for Breach', desc: 'Reasonable compensation, remoteness, and quantification of loss', url: 'https://www.indiacode.nic.in/show-data?actid=AC_CEN_3_20_00035_187209_1523340333624&sectionId=30827&sectionno=73' },
    { title: 'Sec 74 — Liquidated Damages', desc: 'Pre-agreed compensation must be a genuine estimate, not a penalty', url: 'https://www.indiacode.nic.in/show-data?actid=AC_CEN_3_20_00035_187209_1523340333624&sectionId=30828&sectionno=74' },
  ]},
  { category: 'Trusted Portals & Free Legal Aid', items: [
    { title: 'India Code — Official Statutes Database', desc: 'Government repository for all central and state acts', url: 'https://www.indiacode.nic.in/' },
    { title: 'Supreme Court of India', desc: 'Official site for SC judgments, cause lists, and rules', url: 'https://main.sci.gov.in/' },
    { title: 'eCourts Services', desc: 'Case status, orders, and cause lists for district & high courts', url: 'https://ecourts.gov.in/ecourts_home/' },
    { title: 'NALSA — Free Legal Services', desc: 'Eligibility for free legal aid under the Legal Services Authorities Act', url: 'https://nalsa.gov.in/' },
    { title: 'Bar Council of India', desc: 'Advocate verification and professional standards', url: 'https://www.barcouncilofindia.org/' },
    { title: 'Ministry of Corporate Affairs (MCA)', desc: 'Company filings, master data, and DIN verification', url: 'https://www.mca.gov.in/' },
  ]},
]

export default function LibraryPage({ onBack }: { onBack?: () => void }) {
  const [query, setQuery] = useState('')

  // Filter resources live by title, description, or category. Categories with
  // no surviving items are dropped so the list collapses around matches.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return RESOURCES
    return RESOURCES.map((section) => {
      const categoryMatches = section.category.toLowerCase().includes(q)
      const items = categoryMatches
        ? section.items
        : section.items.filter(
            (item) =>
              item.title.toLowerCase().includes(q) ||
              item.desc.toLowerCase().includes(q),
          )
      return { ...section, items }
    }).filter((section) => section.items.length > 0)
  }, [query])

  const resultCount = filtered.reduce((sum, section) => sum + section.items.length, 0)

  return (
    <div className="flex flex-col h-screen bg-cream overflow-hidden">
      {/* ── Header (matches ToolLayout) ── */}
      <div className="shrink-0 px-6 pt-4 pb-3 border-b border-cream-200 bg-white/50">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            {onBack && (
              <button
                onClick={onBack}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-surface-400 hover:text-surface-200 hover:bg-cream-100 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-suits-500/10 flex items-center justify-center">
              <BookOpen className="w-[18px] h-[18px] text-suits-600" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-surface-200">Library & Sources</h1>
              <p className="text-xs text-cream-400">Legal references used by our analysis agents</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          {/* Search / filter */}
          <div className="relative mb-6">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-cream-400 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search acts, sections, or topics…"
              className="w-full bg-white border border-cream-200 rounded-xl pl-10 pr-10 py-2.5 text-sm text-surface-200 placeholder:text-cream-400 outline-none focus:border-suits-400 focus:shadow-sm transition-all"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-md text-cream-400 hover:text-surface-200 hover:bg-cream-100 transition-colors"
                title="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {query.trim() && (
            <p className="text-xs text-cream-400 mb-4">
              {resultCount} {resultCount === 1 ? 'resource' : 'resources'} matching “{query.trim()}”
            </p>
          )}

          {resultCount === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm font-medium text-surface-200">No matching resources</p>
              <p className="text-xs text-cream-400 mt-1">Try a different act, section, or keyword.</p>
            </div>
          ) : (
          <motion.div key={query} variants={staggerContainer} initial="hidden" animate="visible" className="space-y-8">
            {filtered.map((section) => (
              <motion.div key={section.category} variants={staggerItem}>
                <p className="text-xs font-medium text-cream-400 uppercase tracking-wider mb-3">{section.category}</p>
                <div className="space-y-2">
                  {section.items.map((item) => (
                    <a
                      key={item.title}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-3 bg-white rounded-xl border border-cream-200 p-4 hover:shadow-sm hover:border-suits-300 transition-all group cursor-pointer"
                    >
                      <ExternalLink className="w-4 h-4 text-suits-500 shrink-0 mt-0.5 group-hover:text-suits-600 transition-colors" />
                      <div>
                        <p className="text-sm font-medium text-surface-200 group-hover:text-suits-600 transition-colors">{item.title}</p>
                        <p className="text-xs text-cream-400 mt-0.5">{item.desc}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
