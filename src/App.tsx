
import { useState } from 'react'

type Section = 'Overview' | 'My Circles' | 'Contributions' | 'Reliability'

type Transaction = {
  id: number
  circle: string
  amount: number
  date: string
  status: 'Completed' | 'Demo recorded'
}

const initialTransactions: Transaction[] = [
  { id: 1, circle: "Women's Growth Circle", amount: 2000, date: 'Oct 12, 2026', status: 'Completed' },
  { id: 2, circle: 'Community Savers', amount: 2000, date: 'Sep 12, 2026', status: 'Completed' },
  { id: 3, circle: "Women's Growth Circle", amount: 2000, date: 'Sep 05, 2026', status: 'Completed' },
  { id: 4, circle: 'Community Savers', amount: 2000, date: 'Aug 12, 2026', status: 'Completed' },
]

const circles = [
  { name: "Women's Growth Circle", members: 10, contribution: 2000, progress: 70, color: 'bg-emerald-100 text-emerald-700', initials: 'WG', due: 'Oct 25, 2026' },
  { name: 'Community Savers', members: 8, contribution: 1500, progress: 55, color: 'bg-violet-100 text-violet-700', initials: 'CS', due: 'Oct 28, 2026' },
]

const money = (amount: number) =>
  '₹' + amount.toLocaleString('en-IN')

function App() {
  const [section, setSection] = useState<Section>('Overview')
  const [saved, setSaved] = useState(8000)
  const [transactions, setTransactions] = useState(initialTransactions)
  const [notice, setNotice] = useState('')
  const [showProfile, setShowProfile] = useState(false)

  function recordContribution(circleName: string, amount: number) {
    const transaction: Transaction = {
      id: Date.now(),
      circle: circleName,
      amount,
      date: 'Today',
      status: 'Demo recorded',
    }

    setTransactions(previous => [transaction, ...previous])
    setSaved(previous => previous + amount)
    setNotice(`${money(amount)} demo contribution recorded successfully. No real money was transferred.`)
    setSection('Contributions')
  }

  const navItems: { label: Section; icon: string }[] = [
    { label: 'Overview', icon: '⌂' },
    { label: 'My Circles', icon: '◉' },
    { label: 'Contributions', icon: '↗' },
    { label: 'Reliability', icon: '◇' },
  ]

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 md:flex">
      <aside className="flex w-full shrink-0 flex-col bg-white p-5 md:min-h-screen md:w-64 md:border-r md:border-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-700 text-2xl font-bold text-white">
            C
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-emerald-800">
              CircleCred
            </h1>
            <p className="text-xs text-slate-500">Save together. Grow together.</p>
          </div>
        </div>

        <p className="mb-3 mt-8 text-xs font-bold uppercase tracking-widest text-slate-400">
          Workspace
        </p>

        <nav className="flex flex-wrap gap-2 md:flex-col">
          {navItems.map(item => (
            <button
              key={item.label}
              onClick={() => {
                setSection(item.label)
                setNotice('')
              }}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
                section === item.label
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-8 rounded-2xl bg-emerald-50 p-4 md:mt-auto">
          <div className="mb-2 text-xl">🌱</div>
          <h3 className="font-bold text-emerald-900">Small savings, big goals</h3>
          <p className="mt-2 text-xs leading-5 text-emerald-800">
            Consistent contributions help you build a record of your savings habits.
          </p>
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-slate-100 pt-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 font-bold text-amber-800">
            AS
          </div>
          <div>
            <p className="text-sm font-bold">Ananya Sharma</p>
            <p className="text-xs text-slate-500">Circle member · Demo</p>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-5 sm:p-8 lg:p-10">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-500">Monday, October 19, 2026</p>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {section === 'Overview' ? 'Your savings overview' : section}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Welcome back, Ananya. Keep building your savings journey.
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600">
            ◉ Demo account
          </div>
        </header>

        {notice && (
          <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <span>✓ {notice}</span>
            <button onClick={() => setNotice('')} className="font-bold">Dismiss</button>
          </div>
        )}

        {section === 'Overview' && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard title="Total Saved" value={money(saved)} icon="₹" detail="Recorded demo contributions" />
              <StatCard title="Active Circles" value="2" icon="◉" detail="Community savings groups" />
              <StatCard title="This Month" value={money(0)} icon="↗" detail="New contributions this month" />
              <StatCard title="Reliability Score" value="750/850" icon="◇" detail="Illustrative internal score" />
            </section>

            <section className="mt-8 grid gap-6 xl:grid-cols-3">
              <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm xl:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold">My Savings Circles</h3>
                    <p className="mt-1 text-sm text-slate-500">Your groups and upcoming contributions</p>
                  </div>
                  <button onClick={() => setSection('My Circles')} className="text-sm font-bold text-emerald-700 hover:underline">
                    View all →
                  </button>
                </div>

                <div className="mt-5 space-y-4">
                  {circles.map(circle => (
                    <div key={circle.name} className="rounded-xl border border-slate-100 p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className={`flex h-12 w-12 items-center justify-center rounded-xl font-bold ${circle.color}`}>
                          {circle.initials}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold">{circle.name}</h4>
                          <p className="mt-1 text-xs text-slate-500">
                            {circle.members} members · {money(circle.contribution)} / month
                          </p>
                        </div>
                        <span className="text-sm font-bold text-slate-700">{circle.progress}%</span>
                      </div>
                      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${circle.progress}%` }} />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                        <span>Next due: {circle.due}</span>
                        <button onClick={() => recordContribution(circle.name, circle.contribution)} className="rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-800">
                          Record demo payment
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl bg-emerald-800 p-6 text-white shadow-sm">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-emerald-100">Your Savings Reliability</p>
                  <span className="text-2xl">◇</span>
                </div>
                <p className="mt-5 text-4xl font-extrabold">750<span className="text-lg font-medium text-emerald-200"> / 850</span></p>
                <p className="mt-2 text-sm text-emerald-100">Illustrative demo score</p>
                <div className="mt-5 h-2 rounded-full bg-emerald-950/40">
                  <div className="h-full rounded-full bg-emerald-300" style={{ width: `${750 / 850 * 100}%` }} />
                </div>
                <p className="mt-5 text-sm leading-6 text-emerald-50">
                  Your profile can summarize recorded contributions, consistency, and completed savings cycles.
                </p>
                <button onClick={() => setSection('Reliability')} className="mt-6 w-full rounded-xl bg-white px-4 py-3 text-sm font-bold text-emerald-900 hover:bg-emerald-50">
                  Understand my score →
                </button>
                <p className="mt-4 text-xs leading-5 text-emerald-200">
                  This is an internal demonstration indicator, not an official credit score or a loan guarantee.
                </p>
              </div>
            </section>

            <section className="mt-8 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold">Recent Contributions</h3>
                  <p className="mt-1 text-sm text-slate-500">A transparent record of your savings activity</p>
                </div>
                <button onClick={() => setSection('Contributions')} className="text-sm font-bold text-emerald-700 hover:underline">
                  See history →
                </button>
              </div>
              <TransactionTable transactions={transactions.slice(0, 4)} />
            </section>
          </>
        )}

        {section === 'My Circles' && (
          <section className="grid gap-5 lg:grid-cols-2">
            {circles.map(circle => (
              <div key={circle.name} className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold ${circle.color}`}>{circle.initials}</div>
                  <div>
                    <h3 className="text-lg font-bold">{circle.name}</h3>
                    <p className="text-sm text-slate-500">{circle.members} members · Monthly circle</p>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-4">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-500">Your contribution</p>
                    <p className="mt-2 text-xl font-bold">{money(circle.contribution)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs text-slate-500">Potential monthly pool</p>
                    <p className="mt-2 text-xl font-bold">{money(circle.contribution * circle.members)}</p>
                  </div>
                </div>
                <div className="mt-5 flex justify-between text-sm">
                  <span className="text-slate-500">Illustrative group progress</span>
                  <strong>{circle.progress}%</strong>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-emerald-600" style={{ width: `${circle.progress}%` }} />
                </div>
                <p className="mt-4 text-sm text-slate-500">Next due: {circle.due}</p>
                <button onClick={() => recordContribution(circle.name, circle.contribution)} className="mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800">
                  Record demo contribution
                </button>
              </div>
            ))}
          </section>
        )}

        {section === 'Contributions' && (
          <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">Contribution History</h3>
                <p className="mt-1 text-sm text-slate-500">Recorded activity for your demo account</p>
              </div>
              <span className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                {transactions.length} records
              </span>
            </div>
            <TransactionTable transactions={transactions} />
            <p className="mt-4 text-xs leading-5 text-slate-500">
              Demo data is stored only in the current app session. It is not a verified financial transaction history.
            </p>
          </section>
        )}

        {section === 'Reliability' && (
          <section className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-2xl bg-emerald-800 p-7 text-white lg:col-span-1">
              <p className="text-sm text-emerald-100">Illustrative Reliability Score</p>
              <p className="mt-4 text-5xl font-extrabold">750<span className="text-xl text-emerald-200">/850</span></p>
              <div className="mt-5 h-2 rounded-full bg-emerald-950/40">
                <div className="h-full rounded-full bg-emerald-300" style={{ width: `${750 / 850 * 100}%` }} />
              </div>
              <p className="mt-5 text-sm leading-6 text-emerald-50">
                This sample score is for demonstrating the interface. A real score must be calculated from verified contribution records and documented rules.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm lg:col-span-2">
              <h3 className="text-lg font-bold">What shapes your profile?</h3>
              <p className="mt-1 text-sm text-slate-500">These are example indicators, not calculated results.</p>
              <div className="mt-6 space-y-5">
                <ScoreFactor title="On-time contributions" description="Whether recorded payments met their agreed deadlines." />
                <ScoreFactor title="Savings consistency" description="How regularly contributions were made across cycles." />
                <ScoreFactor title="Completed cycles" description="Participation in completed savings-circle cycles." />
                <ScoreFactor title="Participation history" description="How long and how consistently you have participated." />
              </div>
              <button onClick={() => setShowProfile(!showProfile)} className="mt-7 rounded-xl border border-emerald-200 px-4 py-3 text-sm font-bold text-emerald-800 hover:bg-emerald-50">
                {showProfile ? 'Hide profile notes' : 'View profile notes'}
              </button>
              {showProfile && (
                <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  Your demo profile uses illustrative values. Production scoring requires reliable transaction verification, clear scoring rules, correction procedures, and appropriate consent before sharing any records.
                </div>
              )}
            </div>
          </section>
        )}

        <footer className="mt-10 border-t border-slate-200 py-5 text-center text-xs leading-5 text-slate-400">
          CircleCred · Community savings, made transparent.
          <br />
          Prototype with simulated data. No real money is transferred.
        </footer>
      </main>
    </div>
  )
}

function StatCard({ title, value, icon, detail }: {
  title: string
  value: string
  icon: string
  detail: string
}) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-lg font-bold text-emerald-700">
          {icon}
        </span>
      </div>
      <p className="mt-4 text-2xl font-extrabold tracking-tight">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </div>
  )
}

function TransactionTable({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">No contributions recorded yet.</p>
  }

  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[570px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
            <th className="py-4 pr-4 font-semibold">Savings circle</th>
            <th className="py-4 pr-4 font-semibold">Date</th>
            <th className="py-4 pr-4 font-semibold">Amount</th>
            <th className="py-4 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map(transaction => (
            <tr key={transaction.id} className="border-b border-slate-50 last:border-0">
              <td className="py-4 pr-4 font-semibold text-slate-700">{transaction.circle}</td>
              <td className="py-4 pr-4 text-slate-500">{transaction.date}</td>
              <td className="py-4 pr-4 font-bold">{money(transaction.amount)}</td>
              <td className="py-4">
                <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${
                  transaction.status === 'Completed'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-800'
                }`}>
                  {transaction.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ScoreFactor({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 font-bold text-emerald-700">✓</span>
      <div>
        <h4 className="font-semibold">{title}</h4>
        <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  )
}

export default App
