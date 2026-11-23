import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import '@fontsource-variable/exo-2';
import type { SignedInState, SignInFailure } from '../../shared/bridge';
import { Aurora } from './Aurora';
import {
  Chevron,
  Envelope,
  Eye,
  EyeOff,
  GoogleMark,
  Lock,
  Shield,
  SignInArrow,
  SignOutArrow,
} from './Glyphs';
import { describeRuntime } from './versions';
import brand from './assets/brand.png';
import mantis from './assets/mantis.webp';
import './signin.css';

const messages: Record<SignInFailure, string> = {
  credentials: 'Email or password is incorrect.',
  unavailable: 'Cannot reach the Sifer identity service. Is it running?',
  invalid: 'Enter your email and password.',
  cancelled: 'Google sign-in was cancelled or timed out.',
  'account-exists': 'This email already has a Sifer password. Sign in with your password.',
  refused: 'Google could not complete the sign-in. Try again.',
};

function Brand() {
  return (
    <header className="brand">
      <img className="brand-tile" src={brand} alt="" draggable={false} />
      <div className="brand-words">
        <span className="brand-name">Sifer</span>
        <span className="brand-product">Motion</span>
      </div>
    </header>
  );
}

function Runtime() {
  return (
    <footer className="runtime">
      <span className="runtime-rule" />
      <Shield className="runtime-shield" />
      <span className="runtime-rule" />
      <p>{describeRuntime(window.sifer.versions)}</p>
    </footer>
  );
}

function Scene({ children }: { children: ReactNode }) {
  return (
    <div className="scene">
      <Aurora />
      <img className="mantis" src={mantis} alt="" draggable={false} />
      <Brand />
      {children}
    </div>
  );
}

export function SignIn() {
  const [state, setState] = useState<SignedInState | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitingForGoogle, setWaitingForGoogle] = useState(false);

  useEffect(() => {
    void window.sifer.auth.state().then(setState);
    return window.sifer.auth.onChange(setState);
  }, []);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      const result = await window.sifer.auth.signIn(email, password);
      setBusy(false);
      if (result.ok) {
        setPassword('');
        setReveal(false);
        setState(result.state);
        return;
      }
      setError(messages[result.reason]);
    },
    [email, password],
  );

  const continueWithGoogle = useCallback(async () => {
    setBusy(true);
    setWaitingForGoogle(true);
    setError(null);
    const result = await window.sifer.auth.signInWithGoogle();
    setBusy(false);
    setWaitingForGoogle(false);
    if (result.ok) {
      setState(result.state);
      return;
    }
    setError(messages[result.reason]);
  }, []);

  const signOut = useCallback(async () => {
    setBusy(true);
    setState(await window.sifer.auth.signOut());
    setBusy(false);
  }, []);

  if (state?.status === 'signed-in') {
    return (
      <Scene>
        <h1 className="headline">
          Welcome to <strong>Sifer</strong>
        </h1>
        <main className="glass">
          <p className="signed-label">Signed in as</p>
          <p className="signed-email">{state.email}</p>
          <p className="signed-hint">
            Drag the orb onto anything on your screen and tell Sifer what to do.
          </p>
          <button type="button" className="primary" onClick={() => void signOut()} disabled={busy}>
            <SignOutArrow className="primary-icon" />
            <span>Sign out</span>
          </button>
          <Runtime />
        </main>
      </Scene>
    );
  }

  return (
    <Scene>
      <h1 className="headline">
        Sign in to <strong>Sifer</strong>
      </h1>
      <main className="glass">
        <button
          type="button"
          className="google"
          onClick={() => void continueWithGoogle()}
          disabled={busy}
        >
          <GoogleMark />
          <span>
            {waitingForGoogle ? 'Finish signing in in your browser' : 'Continue with Google'}
          </span>
        </button>
        <div className="divider" role="separator">
          <span className="divider-gem">or</span>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="email">
            <Envelope />
            Email
          </label>
          <div className="field">
            <input
              id="email"
              type="email"
              autoComplete="username"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
            <Envelope className="field-icon" />
          </div>
          <label htmlFor="password">
            <Lock />
            Password
          </label>
          <div className="field">
            <input
              id="password"
              type={reveal ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              className="field-toggle"
              aria-label={reveal ? 'Hide password' : 'Show password'}
              onClick={() => setReveal((shown) => !shown)}
            >
              {reveal ? <Eye /> : <EyeOff />}
            </button>
          </div>
          <button type="submit" className="primary" disabled={busy}>
            <Chevron className="primary-chevron left" />
            <SignInArrow className="primary-icon" />
            <span>{busy && !waitingForGoogle ? 'Signing in' : 'Sign in'}</span>
            <Chevron className="primary-chevron" />
          </button>
          {error ? <p className="error">{error}</p> : null}
        </form>
        <Runtime />
      </main>
    </Scene>
  );
}
