// Settings / Analytics pages.
function SettingsPage({ user, navigate, onSignOut }) {
  const toast = RFUI.useToast();
  const [name, setName] = React.useState(user?.fullName || '');
  const [units, setUnits] = React.useState(user?.units || 'metric');
  const [dataSaver, setDataSaver] = React.useState(!!user?.dataSaver);

  async function save() {
    try {
      await RF.updateProfile({ fullName: name, units, dataSaver });
      toast('Saved', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function clearData() {
    if (!confirm('Delete all trips and activity?')) return;
    try {
      await RF.clearAllTrips();
      toast('All data cleared', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  return (
    <div className="page fade-in" style={{ maxWidth: 720 }}>
      <div className="page-head">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">Profile, preferences & data.</div>
        </div>
      </div>

      <div className="card">
        <div className="fw-600 mb-4">Profile</div>
        <div className="flex-col gap-4">
          <div className="field">
            <label className="field-label">Full name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Email</label>
            <input className="input" value={user?.email || ''} disabled style={{ opacity: 0.6 }} />
          </div>
        </div>
      </div>

      <div className="card mt-6">
        <div className="fw-600 mb-4">Preferences</div>
        <div className="flex-col gap-4">
          <Toggle label="Units" sub="Distance & time formatting" value={units} options={[['metric','Metric'],['imperial','Imperial']]} onChange={setUnits} />
          <Toggle label="Data saver" sub="Use lower-resolution map tiles on cellular" value={dataSaver ? 'on' : 'off'} options={[['off','Off'],['on','On']]} onChange={(v) => setDataSaver(v === 'on')} />
        </div>
      </div>

      <div className="card mt-6">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="fw-600">Cloud sync</div>
            <div className="text-sm text-secondary">{RF.cloud.info}</div>
          </div>
          <span className={`sync-bar ${RF.cloud.configured ? '' : 'local'}`}><span className="dot"></span>{RF.cloud.label}</span>
        </div>
      </div>

      <div className="card mt-6">
        <div className="fw-600 mb-2" style={{ color: 'var(--color-danger)' }}>Danger zone</div>
        <div className="text-sm text-secondary mb-4">Permanently deletes all your trips and activity from the cloud. This cannot be undone.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={clearData}><I.Trash size={14} /> Clear all data</button>
          <button className="btn btn-secondary" onClick={onSignOut}><I.LogOut size={14} /> Sign out</button>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
        <button className="btn btn-primary" onClick={save}><I.Check size={14} /> Save changes</button>
      </div>
    </div>
  );
}

function Toggle({ label, sub, value, options, onChange }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
      <div>
        <div className="fw-600 text-sm">{label}</div>
        <div className="text-xs text-muted">{sub}</div>
      </div>
      <div className="tabs" style={{ flexShrink: 0 }}>
        {options.map(([k, l]) => (
          <button key={k} className={`tab ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function AnalyticsPage({ navigate }) {
  const trips = RF.getTrips();
  const completed = trips.filter((t) => t.status === 'completed').length;
  const totalSaved = trips.reduce((a, t) => a + (t.timeSaved || 0), 0);
  const totalDist = trips.reduce((a, t) => a + (t.totalDistance || 0), 0);
  // Average minutes saved per completed trip - real number from actual trips
  // rather than a marketing-looking hardcoded "+23% efficiency".
  const avgSaved = completed > 0 ? totalSaved / completed : 0;
  // Stops delivered vs stops total across all trips - that's our "on time"
  // proxy until we capture per-stop scheduled vs actual times.
  const allStops = trips.flatMap((t) => t.optimised || []);
  const deliveredStops = allStops.filter((s) => s.status === 'delivered').length;
  const completionRate = allStops.length > 0 ? (deliveredStops / allStops.length) * 100 : 0;

  // Generate spark bars from trips
  const recent = trips.slice(0, 12).reverse();
  const max = Math.max(1, ...recent.map((t) => t.timeSaved || 0));

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="page-title">Analytics</div>
          <div className="page-sub">Trends across your routes.</div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi"><div className="kpi-label"><I.Route size={14} />Trips</div><div className="kpi-value">{trips.length}</div><div className="kpi-delta">{completed} completed</div></div>
        <div className="kpi"><div className="kpi-label"><I.Clock size={14} />Time saved</div><div className="kpi-value">{Math.round(totalSaved)}m</div><div className="kpi-delta">{completed ? `~${Math.round(avgSaved)}m per trip` : 'No completed trips yet'}</div></div>
        <div className="kpi"><div className="kpi-label"><I.TrendUp size={14} />Distance</div><div className="kpi-value">{totalDist.toFixed(1)}km</div><div className="kpi-delta">walked + driven</div></div>
        <div className="kpi"><div className="kpi-label"><I.CheckCircle size={14} />Stops delivered</div><div className="kpi-value">{deliveredStops}</div><div className="kpi-delta">{allStops.length ? `${completionRate.toFixed(0)}% of ${allStops.length} planned` : 'No stops yet'}</div></div>
      </div>

      <div className="card mt-6">
        <div className="fw-600 mb-4">Time saved per trip</div>
        {recent.length === 0 ? (
          <div className="text-sm text-muted" style={{ padding: 32, textAlign: 'center' }}>No data — run some trips first.</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, padding: '20px 0' }}>
            {recent.map((t, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end' }}>
                  <div style={{ width: '100%', height: `${((t.timeSaved || 0) / max) * 100}%`, background: 'linear-gradient(180deg, var(--color-accent), #5AC8FA)', borderRadius: '4px 4px 0 0', boxShadow: '0 0 12px var(--color-accent-glow)' }}></div>
                </div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{Math.round(t.timeSaved || 0)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

window.SettingsPage = SettingsPage;
window.AnalyticsPage = AnalyticsPage;
