// Auth page (sign in / sign up).
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
    if (!email) e.email = 'Email is required';
    else if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) e.email = 'Enter a valid email';
    if (!password) e.password = 'Password is required';
    else if (password.length < 6) e.password = 'Min 6 characters';
    if (tab === 'signup' && !fullName) e.fullName = 'Name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev) {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const user = tab === 'signin'
        ? await RF.signIn({ email, password })
        : await RF.signUp({ email, password, fullName });
      toast(tab === 'signin' ? 'Welcome back' : 'Account created', 'success');
      // onAuthed in app.jsx is role-aware (admins -> /admin, drivers -> /dashboard).
      onAuthed(user);
    } catch (e) { toast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  // Pre-fills the form with a shared demo account so reviewers can poke around
  // without creating their own login. The demo accounts must already exist in
  // Supabase (seed once via a normal signup); we don't auto-create them here
  // - that path led to the "Alex Driver" placeholder being written into a
  // real user's profile when they accidentally typed the demo email.
  function quickDemo(role = 'driver') {
    if (role === 'admin') {
      setEmail('admin@routeflow.app');
      setPassword('admin12345');
    } else {
      setEmail('demo@routeflow.app');
      setPassword('demo123');
    }
    setTab('signin');
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

        <div className="divider"></div>
        <div className="text-xs text-muted" style={{ textAlign: 'center', marginBottom: 8 }}>
          Just exploring? Pre-fill a shared demo login (review & evaluation only)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button type="button" className="btn btn-secondary btn-block" onClick={() => quickDemo('driver')}>
            <I.Sparkles size={14} /> Driver demo
          </button>
          <button type="button" className="btn btn-secondary btn-block" onClick={() => quickDemo('admin')}>
            <I.Shield size={14} /> Admin demo
          </button>
        </div>
        <div className="text-xs text-muted mt-4" style={{ textAlign: 'center' }}>
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
