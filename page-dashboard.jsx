// Dashboard — KPIs, recent trips table, live activity feed.
function DashboardPage({ navigate }) {
  const toast = RFUI.useToast();
  const [trips, setTrips] = React.useState([]);
  const [activity, setActivity] = React.useState([]);
  const [q, setQ] = React.useState('');
  const [loading, setLoading] = React.useState(true);

  function refresh() {
    setTrips(RF.getTrips());
    setActivity(RF.getActivity());
  }

  React.useEffect(() => {
    setLoading(true);
    setTimeout(() => { refresh(); setLoading(false); }, 350);
    // Realtime: refresh whenever store cache changes (trips/stops/activity)
    const off = RF.subscribe(refresh);
    return off;
  }, []);

  async function del(id) {
    if (!confirm('Delete this trip?')) return;
    await RF.deleteTrip(id);
    toast('Trip deleted', 'success');
    refresh();
  }

  const filtered = React.useMemo(
    () => trips.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase())),
    [trips, q]
  );

  const totalStops = trips.reduce((a, t) => a + (t.stops || 0), 0);
  const totalDist = trips.reduce((a, t) => a + (t.totalDistance || 0), 0);
  const totalSaved = trips.reduce((a, t) => a + (t.timeSaved || 0), 0);

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="page-title">Dashboard</div>
            <span className={`sync-bar ${RF.cloud.configured ? '' : 'local'}`}>
              <span className="dot"></span>
              {RF.cloud.label}
            </span>
          </div>
          <div className="page-sub">Live overview of your routes, time saved, and field activity.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => { refresh(); toast('Refreshed', 'info'); }}><I.Refresh size={14} /> Refresh</button>
          <button className="btn btn-primary" onClick={() => navigate('create-trip')}><I.Plus size={14} /> New trip</button>
        </div>
      </div>

      <div className="kpi-grid">
        {[
          { label: 'Total trips', icon: I.Route, value: trips.length, delta: trips.length ? `+${Math.min(trips.length, 3)} this week` : 'No trips yet', up: trips.length > 0 },
          { label: 'Stops delivered', icon: I.PinDrop, value: totalStops, delta: `${totalStops} total stops`, up: totalStops > 0 },
          { label: 'Time saved', icon: I.Clock, value: `${Math.round(totalSaved)}m`, delta: 'vs. drive-only baseline', up: true },
          { label: 'Distance', icon: I.TrendUp, value: `${totalDist.toFixed(1)}km`, delta: 'walked + driven', up: true },
        ].map((k, i) => {
          const Ico = k.icon;
          return (
            <div key={i} className="kpi">
              <div className="kpi-label"><Ico className="ico" size={14} />{k.label}</div>
              <div className="kpi-value">{loading ? <span className="skel" style={{ display: 'inline-block', width: 80, height: 28 }}></span> : k.value}</div>
              <div className={`kpi-delta ${k.up ? 'up' : ''}`}>{k.delta}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24, marginTop: 28 }} className="dash-grid">
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Recent trips</div>
            <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 280 }}>
              <I.Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input className="input" placeholder="Search trips" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 36, height: 38 }} />
            </div>
          </div>

          {loading ? (
            <div className="card"><div className="skel" style={{ height: 200 }}></div></div>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <div className="empty-icon"><I.Route size={24} /></div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>No trips yet</div>
              <div className="text-secondary text-sm mt-2" style={{ maxWidth: 320, margin: '8px auto 0' }}>Create your first optimised route to see it here. The system saves automatically.</div>
              <button className="btn btn-primary mt-6" onClick={() => navigate('create-trip')}><I.Plus size={14} /> Create trip</button>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Trip</th>
                    <th className="hide-mobile">Date</th>
                    <th>Stops</th>
                    <th className="hide-mobile">Saved</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} className="row-hover">
                      <td>
                        <div style={{ fontWeight: 600 }}>{t.name}</div>
                        <div className="text-xs text-muted mono">{t.id.slice(0, 8)}</div>
                      </td>
                      <td className="hide-mobile mono text-sm text-secondary">{new Date(t.date).toLocaleDateString()}</td>
                      <td className="mono">{t.stops}</td>
                      <td className="hide-mobile mono">{Math.round(t.timeSaved)}m</td>
                      <td>
                        <span className={`chip ${t.status === 'completed' ? 'chip-walk' : t.status === 'in-progress' ? 'chip-accent' : 'chip-muted'}`}>
                          {t.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => navigate('summary', { tripId: t.id })} title="View"><I.Eye size={14} /></button>
                          {t.status !== 'completed' && (
                            <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => navigate('live', { tripId: t.id })} title="Continue"><I.Play size={12} /></button>
                          )}
                          <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => del(t.id)} title="Delete"><I.Trash size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="live-side">
          <div className="card" style={{ padding: 0 }}>
            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-walk)', boxShadow: '0 0 0 4px rgba(48, 209, 88, 0.18)' }}></span>
                Live activity
              </div>
              <span className="chip chip-muted">{activity.length}</span>
            </div>
            <div style={{ padding: '8px 18px 16px', maxHeight: 360, overflow: 'auto' }}>
              {activity.length === 0 ? (
                <div className="text-sm text-muted" style={{ padding: '16px 0', textAlign: 'center' }}>No activity yet — submit a trip to see updates.</div>
              ) : (
                <div className="feed">
                  {activity.slice(0, 8).map((a) => {
                    const ic = a.type === 'auth' ? I.User : a.type === 'submit' ? I.CheckCircle : a.type === 'delete' ? I.Trash : a.type === 'optimise' ? I.Zap : a.type === 'alert' ? I.AlertTriangle : I.Info;
                    const Ic = ic;
                    const color = a.type === 'alert' ? 'var(--color-warning)' : a.type === 'submit' ? 'var(--color-walk)' : 'var(--color-accent)';
                    return (
                      <div key={a.id} className="feed-item">
                        <div className="feed-dot" style={{ background: 'var(--color-surface-2)', color }}><Ic size={14} /></div>
                        <div className="feed-text">
                          <div className="feed-title">{a.title}</div>
                          <div className="feed-meta">{a.meta} · {timeAgo(a.ts)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="card mt-4">
            <div style={{ fontWeight: 600, fontSize: 15 }}>Quick actions</div>
            <div className="flex-col gap-2 mt-4">
              <button className="btn btn-secondary btn-block" onClick={() => navigate('create-trip')}><I.Plus size={14} /> New trip</button>
              <button className="btn btn-secondary btn-block" onClick={() => navigate('create-trip', { tab: 'csv' })}><I.Upload size={14} /> Import CSV</button>
              <button className="btn btn-ghost btn-block" onClick={() => toast('GitHub repo coming soon', 'info')}><I.Github size={14} /> View source</button>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 1023px) {
          .dash-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function timeAgo(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return Math.floor(d / 86400) + 'd ago';
}

window.DashboardPage = DashboardPage;
