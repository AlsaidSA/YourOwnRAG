/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Sign-in. One screen, two paths: a real credential exchange against the preserved backend,
 * or an explicit "explore with demo data" entry so the console is never a dead end.
 */
import { ArrowRight, Boxes, Cpu, Database, Lock, ServerOff, ShieldCheck } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { OwnRagMark, OwnRagWordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { useAuthStore, type SessionUser } from '@/store/auth';
import { useUiStore } from '@/store/ui';

// The default account of a local engine. It is a compiled-in constant, not something the engine
// discloses: the sign-in page offers it as a convenience only on an engine with no password set.
const LOCAL_DEFAULT_EMAIL = 'owner@ownrag.local';

export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const setSession = useAuthStore((state) => state.setSession);
  const enterDemoMode = useUiStore((state) => state.enterDemoMode);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Probe the API once so the first-run screen can tell the truth about whether a credential
  // exchange is even possible, instead of letting the form fail with a proxy error.
  const [apiReachable, setApiReachable] = React.useState<boolean | null>(null);
  const [passwordRequired, setPasswordRequired] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ password_required?: boolean }>(endpoints.systemVersion)
      .then((info) => {
        if (cancelled) return;
        setApiReachable(true);
        // The engine no longer returns the account from this unauthenticated probe, so the console
        // offers the built-in local default — and only on an engine with no password (the one-click
        // local sign-in). On a secured engine the operator types their own address. The field stays
        // editable either way.
        if (info?.password_required === false) setEmail((current) => current || LOCAL_DEFAULT_EMAIL);
        // An engine with no password configured must not be blocked by a required field: the
        // browser would refuse to submit an empty password and the form would look broken.
        setPasswordRequired(info?.password_required !== false);
      })
      .catch(() => {
        if (!cancelled) setApiReachable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const expired = params.get('reason') === 'expired';

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      // The engine answers with the session *and* the identity behind it. Keeping that identity is what
      // lets the console offer the right surfaces: the sidebar decides from `role`, so a user object
      // built from the address alone hides the manager pages from an owner.
      const result = await api.post<{ access_token?: string; token?: string; user?: SessionUser }>(
        endpoints.login,
        { email, password },
      );
      const token = result?.access_token ?? result?.token;
      if (!token) throw new ApiError('The API did not return a session token.');
      setSession(token, result?.user ?? { email, nickname: email.split('@')[0] ?? email });
      navigate('/');
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Sign-in failed';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const exploreDemo = () => {
    enterDemoMode('You chose to explore the bundled sample corpus');
    setSession('demo.session.token', { email: 'dnn@ownrag.local', nickname: 'dnn' });
    toast({
      title: 'Exploring with demo data',
      description:
        'The console is rendering its bundled sample corpus. Connect the API server at any time — the banner will switch to Live.',
      variant: 'info',
      duration: 9000,
    });
    navigate('/');
  };

  const principles = [
    { icon: Database, title: 'Your data', body: 'Documents stay in your object store and your index. Nothing leaves the deployment.' },
    { icon: Cpu, title: 'Your models', body: 'Point every chat, embedding and rerank slot at your own endpoints or a shared cluster.' },
    { icon: Boxes, title: 'Your agents', body: 'Compose retrieval, tools and code into workflows you can version and roll back.' },
  ];

  return (
    <div className="grid min-h-full grid-cols-1 lg:grid-cols-[minmax(380px,32rem)_1fr]">
      <div className="flex flex-col justify-center border-line bg-surface-1 px-6 py-10 sm:px-12 lg:border-r">
        <div className="mx-auto w-full max-w-sm">
          <OwnRagWordmark size="lg" />
          <h1 className="mt-8 text-2xl font-medium tracking-[-0.02em] text-ink">Sign in to your workspace</h1>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
            OwnRAG runs on your infrastructure. Credentials are checked by your own engine — create an
            account if you do not have one yet.
          </p>

          {expired && (
            <div className="mt-5 flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft px-2.5 py-2 text-2xs text-warn">
              <Lock className="mt-0.5 size-3 shrink-0" />
              <span>Your session expired. Sign in again to continue.</span>
            </div>
          )}

          {apiReachable === false && (
            <div className="mt-5 flex items-start gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-2 text-2xs leading-relaxed text-ink-2">
              <ServerOff className="mt-0.5 size-3 shrink-0 text-ink-3" />
              <span>
                <span className="text-ink">No API server is answering.</span> Signing in needs a
                running OwnRAG backend on port 9380 — use <span className="text-ink">Explore with demo
                data</span> below, or start the API and reload this page.
              </span>
            </div>
          )}

          <form className="mt-6 flex flex-col gap-3" onSubmit={signIn}>
            <Field label="Email" htmlFor="email" required>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                invalid={Boolean(error)}
                required
              />
            </Field>
            <Field label="Password" htmlFor="password" required={passwordRequired}>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder={passwordRequired ? '••••••••' : 'not set on this engine'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                invalid={Boolean(error)}
                required={passwordRequired}
              />
            </Field>
            {!passwordRequired && (
              <p className="-mt-1 text-2xs text-ink-3">
                No password is set on this engine — leave it empty.
              </p>
            )}
            {error && <p className="text-2xs text-danger">{error}</p>}
            <Button type="submit" variant="primary" size="lg" loading={submitting} className="mt-1">
              Sign in
              {!submitting && <ArrowRight className="size-3.5" />}
            </Button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-2xs uppercase tracking-wide text-ink-3">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <Button variant="secondary" size="lg" className="w-full" onClick={exploreDemo}>
            Explore with demo data
          </Button>
          <p className="mt-2 text-center text-2xs text-ink-3">
            Renders a bundled sample corpus so you can review the console without a running backend.
          </p>

          <p className="mt-6 text-center text-xs text-ink-3">
            New to this deployment?{' '}
            <Link to="/signup" className="text-accent hover:text-accent-hover">
              Create an account
            </Link>
          </p>

          <p className="mt-8 flex items-center gap-1.5 text-2xs text-ink-3">
            <ShieldCheck className="size-3" />
            Apache-2.0 · OwnRAG · self-hosted retrieval
          </p>
        </div>
      </div>

      <div className="relative hidden flex-col justify-center overflow-hidden px-12 lg:flex">
        <div className="or-grid-bg pointer-events-none absolute inset-0 opacity-[0.35]" />
        <div className="relative max-w-lg">
          <p className="font-mono text-2xs uppercase tracking-[0.14em] text-accent">
            Own your AI knowledge infrastructure
          </p>
          <h2 className="mt-4 text-3xl font-medium leading-[1.15] tracking-[-0.025em] text-ink">
            Your data.
            <br />
            Your models.
            <br />
            Your RAG.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-2">
            A retrieval platform you operate yourself: template-based chunking, grounded citations,
            fused reranking and an agent runtime — all behind one API you already own.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {principles.map((principle) => (
              <li key={principle.title} className="flex gap-3">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-surface-1 text-accent [&_svg]:size-3.5">
                  <principle.icon />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-ink">{principle.title}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{principle.body}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-10 flex items-center gap-2 text-2xs text-ink-3">
            <OwnRagMark size={16} />
            <span>OwnRAG console — a client of the preserved API surface</span>
          </div>
        </div>
      </div>
    </div>
  );
}
