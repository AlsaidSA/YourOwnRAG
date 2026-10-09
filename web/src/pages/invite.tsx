/* Copyright 2026 OwnRAG contributors — Apache-2.0. */
/*
 * Accepting an invitation. This is the only console page a signed-out stranger with a link can use,
 * and it is deliberately narrow: the engine tells it which workspace and role the link carries and
 * nothing else, and the account is created with the password typed here.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiError } from '@/api/client';
import { endpoints } from '@/api/endpoints';
import { OwnRagMark, OwnRagWordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toaster';
import { useAuthStore } from '@/store/auth';

interface InvitationInfo {
  tenant_id: string;
  email: string;
  role: string;
  expires_at?: number;
  status: string;
}

interface AcceptedSession {
  access_token?: string;
  token?: string;
  email?: string;
  role?: string;
}

function messageOf(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback;
}

export default function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);

  const [nickname, setNickname] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  // The link is the credential, so this request goes out unauthenticated and the engine validates
  // the token itself. A used, revoked or expired link answers with a refusal, not an empty page.
  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get<InvitationInfo>(endpoints.invitationInfo(token)),
    enabled: Boolean(token),
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () => api.post<AcceptedSession>(endpoints.invitationAccept(token), { password, nickname }),
    onSuccess: (session) => {
      const value = session.access_token ?? session.token ?? '';
      if (!value) {
        setError('The engine accepted the invitation but returned no session. Try signing in.');
        return;
      }
      setSession(value);
      toast({ title: 'Welcome aboard', description: 'Your account is ready.', variant: 'success' });
      navigate('/overview', { replace: true });
    },
    onError: (e) => setError(messageOf(e, 'The invitation could not be accepted.')),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setError(null);
    accept.mutate();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-2.5">
          <OwnRagMark className="size-7" />
          <OwnRagWordmark className="h-5" />
        </div>

        {!token || info.isError ? (
          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <div className="flex items-center gap-2 text-ink">
              <AlertTriangle className="size-4 text-danger" />
              <h1 className="text-sm font-medium">This invitation link is not valid any more</h1>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-ink-3">
              Invitations expire and can be revoked or replaced by a newer link. Ask an owner or admin of the workspace
              to send you a fresh one.
            </p>
            <Link to="/login" className="mt-4 inline-flex">
              <Button variant="ghost" size="sm">
                Go to sign in
                <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          </div>
        ) : info.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <Loader2 className="size-4 animate-spin" />
            Checking the invitation…
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface-1 p-5">
            <h1 className="text-sm font-medium text-ink">Join {info.data?.tenant_id}</h1>
            <p className="mt-1 text-xs leading-relaxed text-ink-3">
              You were invited as <span className="font-mono text-ink-2">{info.data?.email}</span> and you will join with
              the role below. Choose a password to finish.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Badge tone="accent" size="sm">
                {info.data?.role ?? 'member'}
              </Badge>
              {info.data?.expires_at ? (
                <span className="text-2xs text-ink-3">
                  Link expires {new Date(info.data.expires_at).toLocaleString()}
                </span>
              ) : null}
            </div>

            <form className="mt-4 flex flex-col gap-3" onSubmit={submit}>
              <Field label="Your name" hint="Optional — shown to the rest of the workspace.">
                <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Your name" />
              </Field>
              <Field label="Password" hint="At least 8 characters, and not built from your email address.">
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Field label="Confirm password">
                <Input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field>
              {error ? <p className="text-xs text-danger">{error}</p> : null}
              <Button type="submit" disabled={accept.isPending}>
                {accept.isPending ? 'Joining…' : 'Join workspace'}
              </Button>
            </form>
          </div>
        )}

        <p className="mt-4 text-2xs text-ink-3">
          This account belongs to the workspace you were invited to. The owner can remove it at any time.
        </p>
      </div>
    </div>
  );
}
