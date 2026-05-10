// Auth page (sign in / sign up). All validation is intentionally lenient -
// Supabase Auth is the source of truth for what a "valid" email/password is,
// and a strict client-side regex was rejecting valid edge-case emails.
function AuthPage({ navigate, onAuthed }) {
  const toast = RFUI.useToast();
  const [tab, setTab] = React.useState('signin');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [fullName, setFullName] = React.useState('');
  const [errors, setErrors] = React.useState({});
  const [loading, setLoading] = React.useState(false);

  function validate() {
    const e = {};
    const trimmed = email.trim();
    if (!trimmed) e.email = 'Email is required';
    // Loose check: just require an "@" and a "." somewhere after it. The
    // browser's type="email" handles the format details, and Supabase will
    // reject anything that's not actually a real address.
    else if (!/.+@.+\..+/.test(trimmed)) e.email = 'Enter a valid email';
    if (!password) e.password = 'Password is required';
    if (tab === 'signup' && !fullName.trim()) e.fullName = 'Name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev) {
    ev.preventDefault();
    if (loading) return; // guard against double-submit -> double signup -> 429
    if (!validate()) return;
    setLoading(true);
    try {
      const user = tab === 'signin'
        ? await RF.signIn({ email: email.trim(), password })
        : await RF.signUp({ email: email.trim(), password, fullName: fullName.trim() });
      toast(tab === 'signin' ? 'Welcome back' : 'Account created', 'success');
      // onAuthed in app.jsx is role-aware (admins -> /admin, drivers -> /dashboard).
      onAuthed(user);
    } catch (e) {
      // Surface Supabase's own error messages (e.g. "User already registered",
      // "Invalid login credentials") - they're more actionable than a generic
      // copy we'd write here.
      toast(e?.message || 'Authentication failed', 'error');
    }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card slide-up">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center', marginBottom: 28 }}>
          <div className="sidebar-brand-mark"><I.Route size={18} stroke="#fff" /></div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>RouteFlow</div>
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', textAlign: 'center' }}>
          {tab === 'signin' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="text-secondary text-sm" style={{ textAlign: 'center', marginTop: 6 }}>
          {tab === 'signin' ? 'Sign in to access your dashboard' : 'Start optimising routes in 30 seconds'}
        </p>

        <div className="tabs" style={{ width: '100%', display: 'flex', marginTop: 24, marginBottom: 24 }}>
          <button type="button" className={`tab ${tab === 'signin' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setTab('signin')}>Sign in</button>
          <button type="button" className={`tab ${tab === 'signup' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setTab('signup')}>Create account</button>
        </div>

        <form onSubmit={submit} className="flex-col gap-4">
          {tab === 'signup' && (
            <div className="field">
              <label className="field-label">Full name</label>
              <input className={`input ${errors.fullName ? 'error' : ''}`} placeholder="Alex Morgan" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              {errors.fullName && <div className="field-error">{errors.fullName}</div>}
            </div>
          )}
          <div className="field">
            <label className="field-label">Email</label>
            <input className={`input ${errors.email ? 'error' : ''}`} type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            {errors.email && <div className="field-error">{errors.email}</div>}
          </div>
          <div className="field">
            <label className="field-label">Password</label>
            <input className={`input ${errors.password ? 'error' : ''}`} type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'signin' ? 'current-password' : 'new-password'} />
            {errors.password && <div className="field-error">{errors.password}</div>}
          </div>
          <button id="auth-submit" type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
            {loading ? <span className="spinner"></span> : (tab === 'signin' ? 'Sign in' : 'Create account')}
            {!loading && <I.ArrowRight size={16} />}
          </button>
        </form>

        <div className="text-xs text-muted mt-6" style={{ textAlign: 'center' }}>
          Real Supabase backend · Postgres + Auth + Realtime · RLS-isolated per user.
        </div>
      </div>
      <button onClick={() => navigate('landing')} className="btn btn-ghost btn-sm" style={{ position: 'absolute', top: 20, left: 20 }}>
        <I.ArrowLeft size={14} /> Back
      </button>
    </div>
  );
}

window.AuthPage = AuthPage;
