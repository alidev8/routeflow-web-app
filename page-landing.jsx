// Landing page
const { useState: useStateL } = React;

function LandingPage({ navigate, isAuthed }) {
  return (
    <div>
      <nav className="landing-nav">
        <div className="landing-brand">
          <div className="landing-brand-mark"><I.Route size={18} stroke="#fff" /></div>
          <span>RouteFlow</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href="#how" className="btn btn-ghost btn-sm hide-mobile">How it works</a>
          <a href="#features" className="btn btn-ghost btn-sm hide-mobile">Features</a>
          {isAuthed ? (
            <button className="btn btn-primary btn-sm" onClick={() => navigate('dashboard')}>Open app <I.ArrowRight size={14} /></button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => navigate('auth')}>Sign in</button>
          )}
        </div>
      </nav>

      <section className="hero">
        <div className="hero-eyebrow"><span className="dot"></span> BSc Final Year Project · Canterbury Christ Church University</div>
        <h1>Stop guessing.<br /><span className="accent">Walk. Drive. Deliver.</span></h1>
        <p>RouteFlow optimises multi-stop delivery routes by intelligently switching between walking and driving for each segment — replacing WhatsApp chaos and spreadsheets with a real, data-driven workflow.</p>
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => navigate(isAuthed ? 'dashboard' : 'auth')}>
            Start optimising <I.ArrowRight size={16} />
          </button>
          <button className="btn btn-secondary btn-lg" onClick={() => document.getElementById('how').scrollIntoView({ behavior: 'smooth' })}>
            See how it works
          </button>
        </div>

        <div className="stats-strip" style={{ marginTop: 56 }}>
          <div className="stat"><div className="stat-num">12 min</div><div className="stat-label">Walking diameter cap per cluster</div></div>
          <div className="stat"><div className="stat-num">2-opt + or-opt</div><div className="stat-label">TSP solver chain</div></div>
          <div className="stat"><div className="stat-num">Live</div><div className="stat-label">Traffic-aware re-decide on every drop</div></div>
          <div className="stat"><div className="stat-num">Realtime</div><div className="stat-label">Supabase sync, offline queue, GPS</div></div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="section-eyebrow">How it works</div>
        <h2 style={{ maxWidth: 720 }}>From a list of postcodes to a live route in under a minute.</h2>
        <p className="lede">Paste your stops, pick a time window, and RouteFlow handles geocoding, clustering and the walking-vs-driving decision per segment. No spreadsheets. No WhatsApp threads.</p>
        <div className="steps-grid">
          {[
            { n: '01', t: 'Enter postcodes', d: 'Paste a list, upload a CSV, or add stops one at a time. Validation is instant.' },
            { n: '02', t: 'Optimise route', d: 'Nearest-neighbour clustering chooses the fastest order and tags each leg as walk or drive.' },
            { n: '03', t: 'Drive & walk', d: 'Live map, turn-by-turn handoff to Google Maps, and a clear next-action button at every stop.' },
            { n: '04', t: 'Track & export', d: 'Trip summary with time saved, distance, and CSV/PDF export — all stored to your dashboard.' },
          ].map((s) => (
            <div key={s.n} className="howstep">
              <div className="howstep-num">STEP {s.n}</div>
              <h4>{s.t}</h4>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="features" style={{ paddingTop: 32 }}>
        <div className="section-eyebrow">Why RouteFlow</div>
        <h2 style={{ maxWidth: 720 }}>Built for the field, not for a spreadsheet.</h2>
        <div className="features-grid">
          {[
            { i: I.Layers, t: 'Hybrid walk/drive', d: 'Clusters of close stops are walked from a single parking spot — saving time and fuel.' },
            { i: I.Zap, t: 'Real persistence', d: 'Every trip, stop and timing is saved to your account so you can pick up where you left off.' },
            { i: I.Smartphone, t: 'Mobile-first', d: 'Built for one-handed use in the cab — large tap targets, GPS-aware live page, queues deliveries when you drop into a black-spot.' },
            { i: I.Shield, t: 'Auth & roles', d: 'Driver and manager logins. Managers see live activity, drivers see only their route.' },
            { i: I.Activity, t: 'Live dashboard', d: 'Recent submissions, completion rate, alerts on failed checks, and time-saved trends.' },
            { i: I.Globe, t: 'Open data formats', d: 'CSV in, CSV/PDF out. No vendor lock-in. Plug into any existing logistics workflow.' },
          ].map((f, i) => {
            const Ico = f.i;
            return (
              <div key={i} className="feature">
                <div className="feature-icon"><Ico size={20} /></div>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 32 }}>
        <div className="section-eyebrow">Built with</div>
        <h2 style={{ maxWidth: 720, fontSize: 28 }}>A modern, production-grade stack.</h2>
        <div className="builtwith mt-6">
          {[
            ['React 18', '#61DAFB'], ['Supabase Auth', '#3ECF8E'], ['Supabase Realtime', '#3ECF8E'],
            ['Postgres + RLS', '#336791'], ['Google Maps', '#4285F4'], ['Routes API v2', '#34A853'],
            ['Vercel', '#FFFFFF'], ['Edge Functions (Deno)', '#000000'],
          ].map(([n, c]) => (
            <span key={n} className="tech-pill"><span className="dot" style={{ background: c }}></span>{n}</span>
          ))}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 32, paddingBottom: 96 }}>
        <div className="card" style={{ padding: 32, display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'center', gap: 24 }}>
          <div>
            <h2 style={{ fontSize: 28 }}>Ready to replace the WhatsApp group?</h2>
            <p className="text-secondary mt-2" style={{ maxWidth: 560 }}>Create an account in 10 seconds. The first trip you optimise is on us — and every other one too.</p>
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => navigate(isAuthed ? 'dashboard' : 'auth')}>
            Get started <I.ArrowRight size={16} />
          </button>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--color-border)', padding: '24px 32px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, color: 'var(--color-text-muted)', fontSize: 13 }}>
        <div>© RouteFlow 2026 · Final-year project</div>
        <div style={{ display: 'flex', gap: 16 }}>
          <a href="#"><I.Github size={16} /> Source</a>
          <a href="#">README</a>
          <a href="#">Architecture</a>
        </div>
      </footer>
    </div>
  );
}

window.LandingPage = LandingPage;
