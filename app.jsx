// Catches any render-time crash inside the wrapped subtree and shows the
// error message instead of letting the app go blank. Without this, a single
// undefined-property access in a deeply-nested page would unmount everything.
class RouteErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[RouteErrorBoundary]', error, info); }
  render() {
    if (this.state.error) {
      const msg = this.state.error?.message || String(this.state.error);
      return (
        <div style={{ minHeight: '100vh', background: 'var(--color-bg)', display: 'grid', placeItems: 'center', padding: 24 }}>
          <div style={{ maxWidth: 480, width: '100%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--r-lg)', padding: 24, textAlign: 'center' }}>
            <div style={{ width: 44, height: 44, margin: '0 auto 14px', borderRadius: 12, background: 'rgba(255, 69, 58, 0.18)', display: 'grid', placeItems: 'center', color: '#ff453a', fontSize: 22, fontWeight: 800 }}>!</div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Something went wrong on this page</h2>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8, wordBreak: 'break-word' }}>{msg}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
              <button className="btn btn-secondary" onClick={() => { this.setState({ error: null }); window.location.hash = 'dashboard'; }}>Back to dashboard</button>
              <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Top-level app: routing, auth gate, layout shell.
//
// Routing model: hash-based. The hash carries both the route name and any
// params as a query string, e.g. `#live?tripId=abc123`. We always serialise
// params to the URL so a hard refresh on the live page (or a deep-linked
// "continue trip" button) keeps working.
function parseHash() {
  const h = (window.location.hash || '').replace(/^#/, '');
  const [route, query = ''] = h.split('?');
  const params = {};
  if (query) {
    for (const part of query.split('&')) {
      if (!part) continue;
      const [k, v = ''] = part.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }
  return { route: route || 'landing', params };
}
function buildHash(route, params) {
  const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return route;
  return route + '?' + entries.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(String(v))).join('&');
}

function App() {
  const initial = parseHash();
  const [ready, setReady] = React.useState(() => RF.isReady());
  const [user, setUser] = React.useState(() => RF.getCurrentUser());
  const [route, setRoute] = React.useState(initial.route || 'landing');
  const [params, setParams] = React.useState(initial.params || {});
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  // Routes that require any signed-in user, and routes that additionally
  // require role=admin. Admin-only access is enforced both at the route level
  // (here) and at the data layer (admin RLS policies in Supabase).
  const authedRoutes = ['dashboard', 'create-trip', 'optimise', 'live', 'summary', 'analytics', 'settings', 'admin', 'admin-users', 'admin-trips'];
  const adminRoutes = ['admin', 'admin-users', 'admin-trips'];

  function navigate(r, p = {}) {
    setRoute(r);
    setParams(p);
    setSidebarOpen(false);
    window.scrollTo(0, 0);
    window.location.hash = buildHash(r, p);
  }

  // Keep state in sync with browser back/forward.
  React.useEffect(() => {
    const onHash = () => {
      const next = parseHash();
      setRoute(next.route);
      setParams(next.params);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Reflect Supabase auth state changes back into React state.
  React.useEffect(() => {
    const onUserChanged = () => setUser(RF.getCurrentUser());
    window.addEventListener('rf:user-changed', onUserChanged);
    const offReady = RF.onReady(() => {
      setReady(true);
      const u = RF.getCurrentUser();
      setUser(u);
      // If the URL has no hash and the user is signed in, route based on role:
      // admins land on /admin, drivers land on /dashboard. Otherwise honour
      // the hash they came in with.
      const cur = parseHash();
      if (!cur.route || cur.route === 'landing') {
        if (u) setRoute(u.isAdmin ? 'admin' : 'dashboard');
      }
    });
    return () => {
      window.removeEventListener('rf:user-changed', onUserChanged);
      offReady();
    };
  }, []);

  // If a signed-in driver landed on an admin URL (deep link, refresh on
  // /admin, etc), bounce them back to /dashboard. Done in an effect so we
  // never trigger state updates during render. CRITICAL: this hook must
  // sit above any early `return` so the hook call order stays stable
  // between renders (Rules of Hooks).
  React.useEffect(() => {
    if (ready && user && !user.isAdmin && adminRoutes.includes(route)) {
      navigate('dashboard');
    }
  }, [ready, user, route]);

  // Boot splash: wait until Supabase has resolved the session before deciding
  // whether to show landing/auth or the protected app.
  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--color-bg)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div className="sidebar-brand-mark" style={{ width: 36, height: 36 }}>
            <I.Route size={20} stroke="#fff" />
          </div>
          <div className="spinner"></div>
          <div className="text-sm text-secondary">Connecting to RouteFlow cloud...</div>
        </div>
      </div>
    );
  }

  function onAuthed(u) {
    setUser(u);
    // Admins go straight to the operations console; drivers to their dashboard.
    navigate(u?.isAdmin ? 'admin' : 'dashboard');
  }
  async function onSignOut() {
    await RF.signOut();
    setUser(null);
    navigate('landing');
  }

  if (authedRoutes.includes(route) && !user) {
    return <RFUI.ToastProvider><AuthPage navigate={navigate} onAuthed={onAuthed} /></RFUI.ToastProvider>;
  }
  if (adminRoutes.includes(route) && user && !user.isAdmin) {
    // Render a tiny placeholder while the effect above redirects.
    return null;
  }

  // Landing has its own chrome
  if (route === 'landing') {
    return <RFUI.ToastProvider><LandingPage navigate={navigate} isAuthed={!!user} /></RFUI.ToastProvider>;
  }
  if (route === 'auth') {
    return <RFUI.ToastProvider><AuthPage navigate={navigate} onAuthed={onAuthed} /></RFUI.ToastProvider>;
  }

  // Live page is full-screen
  if (route === 'live') {
    return (
      <RFUI.ToastProvider>
        <RouteErrorBoundary>
          <LivePage navigate={navigate} params={params} />
        </RouteErrorBoundary>
      </RFUI.ToastProvider>
    );
  }

  // App shell
  return (
    <RFUI.ToastProvider>
      <div className="shell">
        <RFUI.Sidebar
          user={user}
          route={route}
          navigate={navigate}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onSignOut={onSignOut}
        />
        <main className="content">
          <RFUI.MobileHeader onMenu={() => setSidebarOpen(true)} title={titleFor(route)} />
          <RouteErrorBoundary>
            {route === 'dashboard' && <DashboardPage navigate={navigate} />}
            {route === 'create-trip' && <CreateTripPage navigate={navigate} params={params} />}
            {route === 'optimise' && <OptimisePage navigate={navigate} params={params} />}
            {route === 'summary' && <SummaryPage navigate={navigate} params={params} />}
            {route === 'analytics' && <AnalyticsPage navigate={navigate} />}
            {route === 'settings' && <SettingsPage user={user} navigate={navigate} onSignOut={onSignOut} />}
            {route === 'admin' && <AdminPage navigate={navigate} tab="overview" />}
            {route === 'admin-users' && <AdminPage navigate={navigate} tab="users" />}
            {route === 'admin-trips' && <AdminPage navigate={navigate} tab="trips" />}
          </RouteErrorBoundary>
        </main>
      </div>
    </RFUI.ToastProvider>
  );
}

function titleFor(r) {
  const map = {
    dashboard: 'Dashboard', 'create-trip': 'New trip', optimise: 'Optimising', summary: 'Trip summary', analytics: 'Analytics', settings: 'Settings',
    admin: 'Operations console', 'admin-users': 'Drivers', 'admin-trips': 'All trips',
  };
  return map[r] || 'RouteFlow';
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
