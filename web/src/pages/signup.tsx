/*
 * Copyright 2026 OwnRAG contributors — Apache-2.0.
 * Create an account. A Configure surface: the form is the whole page, states are explicit, and the
 * engine's own rules (email shape, password length) are mirrored here so the user is not told twice.
 */
import { ArrowRight, Check, Lock, ShieldCheck, UserPlus } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { OwnRagWordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { useAuthStore, type SessionUser } from '@/store/auth';

const MIN_PASSWORD = 8;

/** Local mirror of the engine's rule, so the field can explain itself before a round trip. */
function strengthOf(password: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (password.length < MIN_PASSWORD) return { score: 0, label: `At least ${MIN_PASSWORD} characters` };
  let score = 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return { score: Math.min(score, 3) as 1 | 2 | 3, label: score >= 3 ? 'Strong' : score === 2 ? 'Reasonable' : 'Usable' };
}

export default function SignupPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);
  const [form, setForm] = React.useState({ email: '', nickname: '', password: '', confirm: '' });
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldError, setFieldError] = React.useState<{ email?: string; password?: string; confirm?: string }>({});
  const [signupOpen, setSignupOpen] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    api
      .get<{ registerEnabled?: boolean }>(endpoints.systemConfig)
      .then((config) => {
        if (!cancelled) setSignupOpen(config?.registerEnabled !== false);
      })
      .catch(() => {
        if (!cancelled) setSignupOpen(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const strength = strengthOf(form.password);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problems: typeof fieldError = {};
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(form.email.trim())) problems.email = 'Enter a valid email address';
    if (form.password.length < MIN_PASSWORD) problems.password = `At least ${MIN_PASSWORD} characters`;
    if (form.confirm !== form.password) problems.confirm = 'The two passwords do not match';
    setFieldError(problems);
    if (Object.keys(problems).length > 0) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<{
        access_token?: string;
        token?: string;
        email: string;
        nickname?: string;
        user?: SessionUser;
      }>(endpoints.register, {
        email: form.email.trim().toLowerCase(),
        password: form.password,
        nickname: form.nickname.trim() || undefined,
      });
      const token = result?.access_token ?? result?.token;
      if (!token) throw new ApiError('The API created no session for this account.');
      // The register response may not carry the identity yet, so the address is the fallback and the app
      // shell's `useIdentity` fills in the rest.
      setSession(
        token,
        result.user ?? { email: result.email, nickname: result.nickname ?? result.email.split('@')[0] },
      );
      toast({ title: 'Account created', description: `Signed in as ${result.email}.`, variant: 'success' });
      navigate('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the account');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <OwnRagWordmark size="lg" />
        <h1 className="mt-8 text-2xl font-medium tracking-[-0.02em] text-ink">Create your account</h1>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
          The account lives in this deployment's own database. There is no hosted identity provider,
          and no email is sent anywhere.
        </p>

        {signupOpen === false && (
          <div className="mt-5 flex items-start gap-2 rounded-md border border-warn/40 bg-warn-soft px-2.5 py-2 text-2xs text-warn">
            <Lock className="mt-0.5 size-3 shrink-0" />
            <span>
              This engine is not accepting new accounts. An operator can open it with{' '}
              <span className="font-mono">OWNRAG_ALLOW_SIGNUP=1</span>.
            </span>
          </div>
        )}

        {error && (
          <div className="mt-5 rounded-md border border-danger/40 bg-danger-soft px-2.5 py-2 text-2xs text-danger">
            {error}
          </div>
        )}

        <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
          <Field label="Email" error={fieldError.email} required>
            <Input
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              placeholder="you@company.com"
              invalid={Boolean(fieldError.email)}
            />
          </Field>

          <Field label="Display name" hint="Optional — defaults to the part before the @">
            <Input
              value={form.nickname}
              onChange={(event) => setForm({ ...form, nickname: event.target.value })}
              placeholder="Your name"
            />
          </Field>

          <Field label="Password" error={fieldError.password} required hint={strength.label}>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              invalid={Boolean(fieldError.password)}
            />
          </Field>

          {/* Three segments, token colours only: this is guidance, not a score to chase. */}
          <div className="flex items-center gap-1.5" aria-hidden>
            {[1, 2, 3].map((step) => (
              <span
                key={step}
                className={
                  'h-0.5 flex-1 rounded-full ' +
                  (strength.score >= step ? (strength.score >= 3 ? 'bg-ok' : 'bg-accent') : 'bg-surface-3')
                }
              />
            ))}
          </div>

          <Field label="Confirm password" error={fieldError.confirm} required>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onChange={(event) => setForm({ ...form, confirm: event.target.value })}
              invalid={mismatch}
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={submitting}
            disabled={signupOpen === false}
          >
            {submitting ? 'Creating account…' : 'Create account'}
            {!submitting && <ArrowRight className="ml-1.5 size-3.5" />}
          </Button>
        </form>

        <div className="mt-6 space-y-2 border-t border-line pt-4 text-2xs text-ink-3">
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
            Passwords are stored as scrypt hashes. Sessions expire and can be revoked individually.
          </p>
          <p className="flex items-start gap-2">
            <Check className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
            Repeated failed sign-ins lock the account for a cooling-off period.
          </p>
        </div>

        <p className="mt-6 text-xs text-ink-3">
          Already have an account?{' '}
          <Link to="/login" className="text-accent hover:text-accent-hover">
            Sign in
          </Link>
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-2xs text-ink-3">
          <UserPlus className="size-3" />
          Accounts on this deployment are separate from every other deployment.
        </p>
      </div>
    </div>
  );
}
