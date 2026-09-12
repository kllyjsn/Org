import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../store';
import { ApiError } from '../api';
import { Wordmark } from '../components/Wordmark';
import { ArrowRight, Radar, Sparkles } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useSession((s) => s.login);
  const register = useSession((s) => s.register);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
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

  return (
    <div className="grid min-h-full bg-[#f6f7f2] lg:grid-cols-[1.08fr_.92fr]">
      <section className="td-mesh relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col">
        <div className="relative z-10">
          <Wordmark size="lg" inverse />
        </div>
        <div className="relative z-10 my-auto max-w-xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur">
            <Sparkles size={13} className="text-[#c9f04b]" />
            Account intelligence, mapped
          </div>
          <h1 className="text-6xl font-semibold leading-[.98] tracking-[-0.055em]">
            See the account.
            <span className="block text-[#c9f04b]">Find your way in.</span>
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-300">
            TopDown connects the people, teams, evidence, and strategic
            initiatives behind every complex sale.
          </p>
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {[
              ['29', 'people mapped'],
              ['20', 'teams resolved'],
              ['8', 'active initiatives'],
            ].map(([value, label]) => (
              <div
                key={label}
                className="rounded-2xl border border-white/10 bg-white/[.07] p-4 backdrop-blur"
              >
                <div className="text-2xl font-semibold tracking-tight">{value}</div>
                <div className="mt-1 text-xs text-slate-400">{label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative z-10 flex items-center gap-2 text-xs text-slate-400">
          <Radar size={14} className="text-[#c9f04b]" />
          Public-web research. Evidence attached. No integration required.
        </div>
      </section>

      <section className="flex items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-10 lg:hidden">
            <Wordmark size="lg" />
          </div>
          <div className="mb-8">
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-[#5b4cf0]">
              Your account workspace
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-[-0.045em] text-slate-950">
              {mode === 'login' ? 'Welcome back.' : 'Map your first account.'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {mode === 'login'
                ? 'Pick up where your team left off.'
                : 'Two researched account maps are free.'}
            </p>
          </div>

          <div className="mb-6 grid grid-cols-2 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-sm">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-2 font-semibold transition ${
                mode === m
                  ? 'bg-slate-950 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {m === 'login' ? 'Sign in' : 'Create account'}
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
                onChange={(e) => setName(e.target.value)}
                required
              />
              <input
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
                placeholder="Workspace name (e.g. Acme sales team)"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
              />
            </>
          )}
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-[#5b4cf0] focus:ring-4 focus:ring-[#5b4cf0]/10"
            placeholder={
              mode === 'register' ? 'Password (8+ characters)' : 'Password'
            }
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
            {!busy && <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />}
          </button>
        </form>
        </div>
      </section>
    </div>
  );
}
