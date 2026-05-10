// Operations console for admins/managers. Cross-user visibility via the
// admin RLS policies in Supabase (see migration: add_admin_role_and_policies).
function AdminPage({ navigate, tab: initialTab }) {
  const toast = RFUI.useToast();
  const [tab, setTab] = React.useState(initialTab || 'overview');
  const [stats, setStats] = React.useState(null);
  const [users, setUsers] = React.useState([]);
  const [trips, setTrips] = React.useState([]);
  const [activity, setActivity] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [busyId, setBusyId] = React.useState(null);

  React.useEffect(() => { setTab(initialTab || 'overview'); }, [initialTab]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [s, u, t, a] = await Promise.all([
        RF.admin.stats(),
        RF.admin.fetchUsers(),
        RF.admin.fetchAllTrips(50),
        RF.admin.fetchActivity(80),
      ]);
      setStats(s); setUsers(u); setTrips(t); setActivity(a);
    } catch (e) {
      console.error('[admin] load', e);
      setError(e.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    load();
    // Live tile: reload on any cross-user change picked up by the standard
    // realtime channels the data layer keeps for the signed-in user.
    const off = RF.subscribe(() => {
      // Cheap path: refresh activity only on store-changed; full reload on
      // an explicit refresh button click.
      RF.admin.fetchActivity(80).then(setActivity).catch(() => {});
    });
    return off;
  }, []);

  async function onDeleteTrip(t) {
    if (!confirm(`Delete trip "${t.name}" by ${t.driverName}? This cascades to stops + activity.`)) return;
    setBusyId(t.id);
    try {
      await RF.admin.deleteTrip(t.id);
      toast('Trip deleted', 'success');
      await load();
    } catch (e) {
      toast(e.message || 'Delete failed', 'error');
    } finally { setBusyId(null); }
  }

  async function onPromote(u) {
    const next = u.role === 'admin' ? 'user' : 'admin';
    if (!confirm(`Change ${u.fullName || u.email}'s role to "${next}"?`)) return;
    setBusyId(u.id);
    try {
      await RF.admin.promoteUser(u.id, next);
      toast(`Role updated to ${next}`, 'success');
      await load();
    } catch (e) {
      toast(e.message || 'Role change failed', 'error');
    } finally { setBusyId(null); }
  }

  if (loading && !stats) {
    return (
      <div className="page fade-in" style={{ display: 'grid', placeItems: 'center', minHeight: 400 }}>
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="page-title">Operations console</div>
          <div className="page-sub">Cross-fleet visibility · {stats?.users || 0} drivers · {stats?.trips || 0} trips · {stats?.activity24h || 0} events in 24h</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }}></span> : <I.Refresh size={14} />} Refresh
        </button>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--color-danger,#ff453a)', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <I.AlertTriangle size={16} stroke="var(--color-danger,#ff453a)" />
            <div style={{ fontWeight: 600 }}>Couldn't load admin data</div>
          </div>
          <div className="text-sm text-secondary mt-2">{error}</div>
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => { setTab('overview'); navigate('admin'); }}>Overview</button>
        <button className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => { setTab('users'); navigate('admin-users'); }}>Drivers</button>
        <button className={`tab ${tab === 'trips' ? 'active' : ''}`} onClick={() => { setTab('trips'); navigate('admin-trips'); }}>All trips</button>
      </div>

      {tab === 'overview' && stats && (
        <>
          <div className="kpi-row">
            <KPI label="Active drivers" value={stats.users} icon={I.Sparkles} accent="walk" />
            <KPI label="Active trips" value={stats.tripsActive} icon={I.Layers} accent="accent" />
            <KPI label="Completed trips" value={stats.tripsCompleted} icon={I.Check} accent="walk" />
            <KPI label="Stops planned" value={stats.stops} icon={I.Route} accent="drive" />
            <KPI label="Distance optimised" value={`${stats.totalDistanceKm} km`} icon={I.Car} accent="drive" />
            <KPI label="Time saved" value={`${stats.totalSavedMin} min`} icon={I.Zap} accent="accent" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16, marginTop: 16 }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontWeight: 600 }}>Recent trips across the fleet</div>
                <span className="text-xs text-muted">{trips.length} latest</span>
              </div>
              <TripsTable trips={trips.slice(0, 8)} onDelete={onDeleteTrip} busyId={busyId} compact />
            </div>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontWeight: 600 }}>Live activity</div>
                <span className="chip chip-walk" style={{ fontSize: 11 }}>● live</span>
              </div>
              <ActivityFeed items={activity.slice(0, 12)} />
            </div>
          </div>
        </>
      )}

      {tab === 'users' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ fontWeight: 600 }}>Drivers ({users.length})</div>
            <div className="text-xs text-muted">Promote a driver to admin to give them console access.</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Driver</th><th>Email</th><th>Role</th><th>Trips</th><th>Active</th><th>Last active</th><th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>{(u.fullName || u.email || '?').slice(0, 1).toUpperCase()}</div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{u.fullName || '—'}</div>
                          <div className="text-xs text-muted mono">{u.id.slice(0, 8)}…</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono text-sm">{u.email}</td>
                    <td><span className={`role-badge role-badge-${u.role}`}>{u.role}</span></td>
                    <td>{u.tripsTotal}</td>
                    <td>{u.tripsActive}</td>
                    <td className="text-sm text-secondary">{u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-secondary btn-sm" disabled={busyId === u.id} onClick={() => onPromote(u)}>
                        {busyId === u.id ? '…' : (u.role === 'admin' ? 'Demote' : 'Promote')}
                      </button>
                    </td>
                  </tr>
                ))}
                {!users.length && <tr><td colSpan={7} className="text-center text-muted" style={{ padding: 24 }}>No drivers yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'trips' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ fontWeight: 600 }}>All trips ({trips.length})</div>
            <div className="text-xs text-muted">Cross-driver. Delete cascades stops + activity.</div>
          </div>
          <TripsTable trips={trips} onDelete={onDeleteTrip} busyId={busyId} />
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, icon: Ico, accent }) {
  return (
    <div className="kpi-card">
      <div className={`kpi-icon kpi-icon-${accent || 'accent'}`}><Ico size={16} /></div>
      <div>
        <div className="kpi-value">{value}</div>
        <div className="kpi-label">{label}</div>
      </div>
    </div>
  );
}

function TripsTable({ trips, onDelete, busyId, compact }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Trip</th><th>Driver</th><th>Mode</th><th>Status</th><th>Stops</th><th>Distance</th>{!compact && <th>Saved</th>}<th>Created</th><th></th>
          </tr>
        </thead>
        <tbody>
          {trips.map((t) => (
            <tr key={t.id}>
              <td>
                <div style={{ fontWeight: 600 }}>{t.name}</div>
                <div className="text-xs text-muted mono">{t.id.slice(0, 8)}…</div>
              </td>
              <td>
                <div className="text-sm">{t.driverName}</div>
                {!compact && <div className="text-xs text-muted">{t.driverEmail}</div>}
              </td>
              <td><span className="chip chip-muted" style={{ textTransform: 'capitalize' }}>{t.mode}</span></td>
              <td><span className={`status-pill status-${(t.status || '').replace(/[^a-z]/g, '-')}`}>{t.status || 'draft'}</span></td>
              <td>{t.stops}</td>
              <td className="mono">{t.totalDistance} km</td>
              {!compact && <td className="mono">{Math.round(t.timeSaved)} min</td>}
              <td className="text-sm text-secondary">{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}</td>
              <td style={{ textAlign: 'right' }}>
                <button className="btn btn-ghost btn-sm" disabled={busyId === t.id} onClick={() => onDelete(t)} title="Delete trip">
                  {busyId === t.id ? '…' : <I.Trash size={14} />}
                </button>
              </td>
            </tr>
          ))}
          {!trips.length && <tr><td colSpan={compact ? 8 : 9} className="text-center text-muted" style={{ padding: 24 }}>No trips yet across the fleet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ActivityFeed({ items }) {
  if (!items.length) return <div className="text-sm text-muted">No activity in the last hour.</div>;
  return (
    <div className="flex-col gap-2">
      {items.map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
          <div className="avatar" style={{ width: 26, height: 26, fontSize: 11, flexShrink: 0 }}>{(a.driverName || '?').slice(0, 1).toUpperCase()}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="text-sm" style={{ fontWeight: 600 }}>{a.title}</div>
            <div className="text-xs text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.driverName} · {a.meta || a.type} · {timeAgo(a.ts)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function timeAgo(ts) {
  const d = new Date(ts);
  const sec = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

window.AdminPage = AdminPage;
