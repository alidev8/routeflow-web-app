// Top-level app: routing, auth gate, layout shell.
function App() {
  const [ready, setReady] = React.useState(() => RF.isReady());
  const [user, setUser] = React.useState(() => RF.getCurrentUser());
  const [route, setRoute] = React.useState(() => {
    const h = window.location.hash.replace('#', '') || 'landing';
    return h.split('?')[0];
  });
  const [params, setParams] = React.useState({});
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

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
      const h = window.location.hash.replace('#', '').split('?')[0];
      if (!h) setRoute(u ? (u.isAdmin ? 'admin' : 'dashboard') : 'landing');
    });
    return () => {
      window.removeEventListener('rf:user-changed', onUserChanged);
      offReady();
    };
  }, []);

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

  function navigate(r, p = {}) {
    setRoute(r);
    setParams(p);
    setSidebarOpen(false);
    window.scrollTo(0, 0);
    window.location.hash = r;
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

  // Routes that require any signed-in user, and routes that additionally
  // require role=admin. Admin-only access is enforced both at the route level
  // (here) and at the data layer (admin RLS policies in Supabase).
  const authedRoutes = ['dashboard', 'create-trip', 'optimise', 'live', 'summary', 'analytics', 'settings', 'admin', 'admin-users', 'admin-trips'];
  const adminRoutes = ['admin', 'admin-users', 'admin-trips'];
  if (authedRoutes.includes(route) && !user) {
    return <RFUI.ToastProvider><AuthPage navigate={navigate} onAuthed={onAuthed} /></RFUI.ToastProvider>;
  }
  if (adminRoutes.includes(route) && user && !user.isAdmin) {
    // A signed-in driver tried to hit an admin URL — bounce them home.
    setTimeout(() => navigate('dashboard'), 0);
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
    return <RFUI.ToastProvider><LivePage navigate={navigate} params={params} /></RFUI.ToastProvider>;
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
          {route === 'dashboard' && <DashboardPage navigate={navigate} />}
          {route === 'create-trip' && <CreateTripPage navigate={navigate} params={params} />}
          {route === 'optimise' && <OptimisePage navigate={navigate} params={params} />}
          {route === 'summary' && <SummaryPage navigate={navigate} params={params} />}
          {route === 'analytics' && <AnalyticsPage navigate={navigate} />}
          {route === 'settings' && <SettingsPage user={user} navigate={navigate} onSignOut={onSignOut} />}
          {route === 'admin' && <AdminPage navigate={navigate} tab="overview" />}
          {route === 'admin-users' && <AdminPage navigate={navigate} tab="users" />}
          {route === 'admin-trips' && <AdminPage navigate={navigate} tab="trips" />}
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
