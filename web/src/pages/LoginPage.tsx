import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  Clock3,
  Database,
  GitBranch,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { ApiError } from '../api';
import { Wordmark } from '../components/Wordmark';
import { useSession } from '../store';

const outcomes = [
  {
    icon: Search,
    number: '01',
    title: 'Understand the account faster.',
    body: 'Turn a company domain into an editable map of the people, teams, initiatives, and evidence shaping the deal.',
  },
  {
    icon: GitBranch,
    number: '02',
    title: 'Find a credible path in.',
    body: 'Connect likely champions and buyers through sourced relationships, with inference and uncertainty clearly labeled.',
  },
  {
    icon: Target,
    number: '03',
    title: 'Align on the next move.',
    body: 'Bring account changes, strategy, and recommended actions into one shared workspace your team can keep current.',
  },
];

const audiences = [
  {
    label: 'For sellers',
    title: 'Less account prep. More useful conversations.',
    body: 'Start with a researched map, validate the evidence, and walk into the next meeting knowing who matters and why.',
  },
  {
    label: 'For managers',
    title: 'See the strategy, not another status update.',
    body: 'Review coverage, missing relationships, account movement, and the team’s next action from a shared living plan.',
  },
  {
    label: 'For revenue leaders',
    title: 'Make rigorous account planning repeatable.',
    body: 'Measure activation, research use, collaboration, and movement from intelligence to action without reading private deal content.',
  },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useSession((s) => s.login);
  const register = useSession((s) => s.register);
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name, workspaceName || undefined);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const openAccess = (nextMode: 'login' | 'register') => {
    setMode(nextMode);
    document.getElementById('access')?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  };

  return (
    <div className="min-h-full bg-[#f6f7f2] text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-[#f6f7f2]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          <Wordmark size="md" />
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-500 md:flex">
            <a href="#outcomes" className="hover:text-slate-950">
              Outcomes
            </a>
            <a href="#example" className="hover:text-slate-950">
              Product
            </a>
            <a href="#teams" className="hover:text-slate-950">
              Teams
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openAccess('login')}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-white"
            >
              Sign in
            </button>
            <button
              onClick={() => openAccess('register')}
              className="rounded-lg bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Map an account
            </button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-slate-200">
          <div className="pointer-events-none absolute -left-32 top-10 h-96 w-96 rounded-full bg-[#5b4cf0]/10 blur-3xl" />
          <div className="pointer-events-none absolute right-0 top-0 h-[34rem] w-[34rem] rounded-full bg-[#c9f04b]/10 blur-3xl" />
          <div className="relative mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.12fr_.88fr] lg:items-center lg:py-28">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#5b4cf0]/20 bg-white/70 px-3 py-1.5 text-xs font-semibold text-[#5b4cf0] shadow-sm">
                <Radar size={13} />
                Account intelligence that leads to action
              </div>
              <h1 className="max-w-3xl text-5xl font-semibold leading-[.96] tracking-[-0.06em] text-slate-950 sm:text-7xl">
                Know the account.
                <span className="block text-[#5b4cf0]">Make the right move.</span>
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
                TopDown turns scattered public research into a living account
                plan: who matters, what is changing, how the deal connects, and
                what your team should do next.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  onClick={() => openAccess('register')}
                  className="group flex items-center justify-center gap-2 rounded-xl bg-[#5b4cf0] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(91,76,240,.24)] hover:bg-[#4b3ddd]"
                >
                  Build your first account
                  <ArrowRight
                    size={16}
                    className="transition group-hover:translate-x-0.5"
                  />
                </button>
                <a
                  href="#example"
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-300"
                >
                  See the workflow <ChevronRight size={15} />
                </a>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs font-medium text-slate-500">
                {[
                  'Public-web research',
                  'Evidence attached',
                  'No integration required',
                ].map((item) => (
                  <span key={item} className="flex items-center gap-1.5">
                    <Check size={13} className="text-[#5b4cf0]" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div
              id="access"
              className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-[0_28px_90px_rgba(15,23,42,.12)] backdrop-blur sm:p-7"
            >
              <div className="mb-6">
                <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[#5b4cf0]">
                  Start with one live account
                </p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.045em]">
                  {mode === 'login' ? 'Welcome back.' : 'See value before setup.'}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {mode === 'login'
                    ? 'Pick up where your team left off.'
                    : 'Two researched account maps are free. No integrations required.'}
                </p>
              </div>
              <div className="mb-5 grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
                {(['login', 'register'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setMode(item)}
                    className={`rounded-lg px-3 py-2 font-semibold transition ${
                      mode === item
                        ? 'bg-slate-950 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {item === 'login' ? 'Sign in' : 'Create account'}
                  </button>
                ))}
              </div>
              <form onSubmit={submit} className="space-y-3">
                {mode === 'register' && (
                  <>
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
                      placeholder="Your name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                    />
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
                      placeholder="Workspace name (e.g. North America sales)"
                      value={workspaceName}
                      onChange={(event) => setWorkspaceName(event.target.value)}
                    />
                  </>
                )}
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
                  placeholder="Work email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
                <input
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
                  placeholder={
                    mode === 'register' ? 'Password (8+ characters)' : 'Password'
                  }
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                {error && (
                  <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#5b4cf0] px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(91,76,240,.24)] transition hover:bg-[#4b3ddd] disabled:opacity-60"
                >
                  {busy
                    ? 'Working…'
                    : mode === 'login'
                      ? 'Sign in'
                      : 'Create workspace'}
                  {!busy && <ArrowRight size={16} />}
                </button>
              </form>
            </div>
          </div>
        </section>

        <section id="outcomes" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#5b4cf0]">
              Built around seller outcomes
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
              From research burden to account momentum.
            </h2>
          </div>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {outcomes.map(({ icon: Icon, number, title, body }) => (
              <article
                key={number}
                className="rounded-3xl border border-slate-200 bg-white p-6 td-card-shadow sm:p-7"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eeecff] text-[#5b4cf0]">
                    <Icon size={20} />
                  </span>
                  <span className="font-mono text-xs text-slate-300">{number}</span>
                </div>
                <h3 className="mt-8 text-xl font-semibold tracking-[-0.025em]">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-500">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="example" className="bg-slate-950 py-20 text-white sm:py-28">
          <div className="mx-auto max-w-7xl px-5 sm:px-8">
            <div className="grid gap-12 lg:grid-cols-[.72fr_1.28fr] lg:items-center">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.06] px-3 py-1.5 text-xs text-slate-300">
                  <Sparkles size={13} className="text-[#c9f04b]" />
                  Illustrative workflow: Stripe → Microsoft
                </div>
                <h2 className="mt-6 text-4xl font-semibold leading-tight tracking-[-0.05em] sm:text-5xl">
                  Start with the deal, not a blank canvas.
                </h2>
                <p className="mt-5 text-base leading-7 text-slate-300">
                  A Stripe seller enters microsoft.com. TopDown researches the
                  relevant organization, connects public evidence, surfaces
                  uncertainty, and turns the map into a working plan.
                </p>
                <div className="mt-8 space-y-4">
                  {[
                    ['Before', 'Scattered tabs, a stale slide, and no shared view of the buying group.'],
                    ['After', 'A sourced map, an explicit path hypothesis, and a prioritized next move.'],
                  ].map(([label, copy]) => (
                    <div key={label} className="flex gap-3">
                      <span className="mt-0.5 rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#c9f04b]">
                        {label}
                      </span>
                      <p className="text-sm leading-6 text-slate-300">{copy}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#f6f7f2] text-slate-950 shadow-2xl">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#5b4cf0]">
                      Microsoft account plan
                    </div>
                    <div className="mt-1 text-sm font-semibold">
                      Payments expansion · Illustrative roles
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[#effbd0] px-2.5 py-1 text-[10px] font-semibold">
                      Live deal
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-500 shadow-sm">
                      Evidence on
                    </span>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:p-6 md:grid-cols-[1.25fr_.75fr]">
                  <div className="td-grid relative min-h-[360px] overflow-hidden rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="absolute left-1/2 top-7 z-10 w-44 -translate-x-1/2 rounded-xl border border-[#5b4cf0]/30 bg-white p-3 shadow-lg">
                      <div className="text-[9px] font-semibold uppercase tracking-wide text-[#5b4cf0]">
                        Decision area
                      </div>
                      <div className="mt-1 text-xs font-semibold">
                        Enterprise commerce leader
                      </div>
                      <div className="mt-2 flex gap-1">
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-700">
                          Sourced
                        </span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[8px] text-slate-500">
                          High confidence
                        </span>
                      </div>
                    </div>
                    <div className="absolute left-[10%] top-[47%] z-10 w-36 rounded-xl border border-slate-200 bg-white p-3 shadow-md sm:left-[18%]">
                      <div className="text-[9px] font-semibold uppercase text-slate-400">
                        Champion path
                      </div>
                      <div className="mt-1 text-xs font-semibold">
                        Payments product lead
                      </div>
                      <span className="mt-2 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[8px] font-semibold text-amber-700">
                        Inferred assignment
                      </span>
                    </div>
                    <div className="absolute right-[8%] top-[52%] z-10 w-36 rounded-xl border border-slate-200 bg-white p-3 shadow-md sm:right-[13%]">
                      <div className="text-[9px] font-semibold uppercase text-slate-400">
                        Validation
                      </div>
                      <div className="mt-1 text-xs font-semibold">
                        Procurement partner
                      </div>
                      <span className="mt-2 inline-block rounded bg-emerald-50 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-700">
                        Sourced
                      </span>
                    </div>
                    <div className="absolute bottom-6 left-1/2 z-10 w-40 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 shadow-md">
                      <div className="text-[9px] font-semibold uppercase text-slate-400">
                        Technical influence
                      </div>
                      <div className="mt-1 text-xs font-semibold">
                        Commerce engineering
                      </div>
                      <span className="mt-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[8px] text-slate-500">
                        Needs verification
                      </span>
                    </div>
                    <svg
                      aria-hidden="true"
                      className="absolute inset-0 h-full w-full"
                      viewBox="0 0 500 360"
                      preserveAspectRatio="none"
                    >
                      <path d="M250 95 C180 125 150 155 140 190" fill="none" stroke="#8b82ee" strokeWidth="2" strokeDasharray="5 5" />
                      <path d="M250 95 C320 125 350 155 360 195" fill="none" stroke="#64748b" strokeWidth="2" />
                      <path d="M140 230 C175 275 205 290 250 305" fill="none" stroke="#8b82ee" strokeWidth="2" strokeDasharray="5 5" />
                      <path d="M360 235 C325 275 295 290 250 305" fill="none" stroke="#64748b" strokeWidth="2" />
                    </svg>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-2xl bg-slate-950 p-4 text-white">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[#c9f04b]">
                        <Target size={12} /> Next move
                      </div>
                      <p className="mt-3 text-sm font-semibold leading-5">
                        Validate the product lead, then use the sourced commerce
                        initiative to open a discovery path.
                      </p>
                      <p className="mt-3 text-[10px] leading-4 text-slate-400">
                        Hypothesis. Review evidence before outreach.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        <Clock3 size={12} /> Time to useful map
                      </div>
                      <div className="mt-2 text-2xl font-semibold tracking-tight">
                        Tracked live
                      </div>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500">
                        Measured from research start to an evidence-backed map.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        <Database size={12} /> Proof, not decoration
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">
                        Open every source. See confidence. Separate sourced facts
                        from mapped hypotheses.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="teams" className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-10 lg:grid-cols-[.72fr_1.28fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#5b4cf0]">
                One account truth
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
                Useful at every altitude.
              </h2>
              <p className="mt-5 text-base leading-7 text-slate-500">
                The same map helps the seller prepare, the manager coach, and
                the revenue leader understand whether account planning is
                creating action.
              </p>
            </div>
            <div className="divide-y divide-slate-200 border-y border-slate-200">
              {audiences.map((audience) => (
                <article
                  key={audience.label}
                  className="grid gap-3 py-6 sm:grid-cols-[140px_1fr]"
                >
                  <div className="text-xs font-semibold uppercase tracking-[.12em] text-[#5b4cf0]">
                    {audience.label}
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold tracking-[-0.025em]">
                      {audience.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      {audience.body}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-4 mb-4 overflow-hidden rounded-3xl bg-[#5b4cf0] text-white sm:mx-6 sm:mb-6">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 px-6 py-12 sm:px-10 lg:flex-row lg:items-center lg:py-14">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.15em] text-white/70">
                <ShieldCheck size={15} />
                Start without integrations
              </div>
              <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">
                Bring one account. Leave with a clearer next move.
              </h2>
            </div>
            <button
              onClick={() => openAccess('register')}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-[#c9f04b] px-5 py-3.5 text-sm font-semibold text-slate-950 shadow-lg hover:bg-[#d6f56b]"
            >
              Build your first map <ArrowRight size={16} />
            </button>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <Wordmark size="sm" />
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <Users size={12} /> Collaborative by design
          </span>
          <span className="flex items-center gap-1.5">
            <BarChart3 size={12} /> Outcomes measured privately
          </span>
        </div>
      </footer>
    </div>
  );
}
