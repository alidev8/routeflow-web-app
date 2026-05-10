// Optimisation progress page
function OptimisePage({ navigate, params }) {
  const toast = RFUI.useToast();
  const [stage, setStage] = React.useState('geocoding');
  const [pct, setPct] = React.useState(0);
  const [optimised, setOptimised] = React.useState([]);
  const [trip, setTrip] = React.useState(null);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [skipped, setSkipped] = React.useState([]);

  React.useEffect(() => {
    const t = RF.getTrip(params?.tripId);
    if (!t) { toast('Trip not found', 'error'); navigate('dashboard'); return; }
    setTrip(t);
    let cancelled = false;
    (async () => {
      try {
        const stops = await RF.optimiseRoute(t.stopList, t.mode, ({ stage, pct }) => {
          if (cancelled) return;
          setStage(stage); setPct(pct);
        }, t.id);
        if (cancelled) return;
        setOptimised(stops);
        if (Array.isArray(stops.skipped) && stops.skipped.length) {
          setSkipped(stops.skipped);
          toast(`${stops.skipped.length} postcode${stops.skipped.length === 1 ? '' : 's'} couldn't be located`, 'warning');
        }
        const fresh = RF.getTrip(t.id) || t;
        setTrip({ ...fresh, optimised: stops });
        setDone(true);
      } catch (e) {
        if (cancelled) return;
        const msg = (e && e.message) ? e.message : 'Optimisation failed';
        console.error('[optimise]', e);
        setError(msg);
        toast(msg, 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [params?.tripId]);

  function retry() {
    setError(null); setPct(0); setStage('geocoding'); setDone(false);
    // re-trigger the effect by remounting via a key swap - cheapest is to navigate away/back.
    navigate('optimise', { tripId: params?.tripId, _t: Date.now() });
  }

  const stages = [
    { k: 'geocoding', label: 'Geocoding postcodes' },
    { k: 'optimising', label: 'Clustering & ordering' },
    { k: 'saving', label: 'Saving to dashboard' },
  ];

  return (
    <div className="page fade-in" style={{ maxWidth: 880 }}>
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('dashboard')} style={{ marginBottom: 12 }}>
        <I.ArrowLeft size={14} /> Dashboard
      </button>
      <div className="page-head">
        <div>
          <div className="page-title">{done ? 'Route ready' : 'Optimising route'}</div>
          <div className="page-sub">{trip?.name}</div>
        </div>
        {done && <span className="chip chip-walk"><I.Check size={12} /> Optimised</span>}
      </div>

      {skipped.length > 0 && (
        <div className="card" style={{ borderColor: '#FF9F0A', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <I.AlertTriangle size={16} stroke="#FF9F0A" />
            <div style={{ fontWeight: 600 }}>{skipped.length} postcode{skipped.length === 1 ? '' : 's'} skipped</div>
          </div>
          <div className="text-sm text-secondary mt-2">
            Couldn't locate: <span className="mono">{skipped.join(', ')}</span>. The route uses the {optimised.length} postcodes that resolved.
          </div>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--color-danger, #ff453a)', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <I.AlertTriangle size={16} stroke="var(--color-danger, #ff453a)" />
            <div style={{ fontWeight: 600 }}>Couldn't optimise this route</div>
          </div>
          <div className="text-sm text-secondary mt-2">{error}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={() => navigate('dashboard')}>Back</button>
            <button className="btn btn-primary" onClick={retry}>Try again</button>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 600 }}>{error ? 'Stopped' : done ? 'Complete' : 'Working...'}</div>
          <div className="mono text-sm text-secondary">{pct}%</div>
        </div>
        <div className="progress-track"><div className="progress-fill" style={{ width: pct + '%' }}></div></div>
        <div className="flex-col gap-2 mt-6">
          {stages.map((s) => {
            const active = stage === s.k;
            const isDone = done || stages.findIndex((x) => x.k === stage) > stages.findIndex((x) => x.k === s.k);
            return (
              <div key={s.k} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  background: isDone ? 'var(--color-walk)' : active ? 'var(--color-accent)' : 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)' }}>
                  {isDone ? <I.Check size={11} stroke="#052013" /> : active ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }}></span> : <span style={{ width: 6, height: 6, background: 'var(--color-text-muted)', borderRadius: '50%' }}></span>}
                </div>
                <div className={active || isDone ? '' : 'text-muted'} style={{ fontSize: 14 }}>{s.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card mt-6" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 600 }}>Route preview</div>
          {done && trip && (
            <div className="text-sm text-secondary mono">{trip.totalDistance}km · {Math.round(trip.timeSaved)}m saved</div>
          )}
        </div>
        <FakeMap stops={optimised.length ? optimised : []} height={280} withLabels />
      </div>

      {done && (
        <div style={{ display: 'flex', gap: 8, marginTop: 24, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => navigate('dashboard')}>Back to dashboard</button>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('live', { tripId: trip.id })}>
            <I.Play size={14} /> Start delivery
          </button>
        </div>
      )}
    </div>
  );
}

const FakeMap = (props) => RFUI.FakeMap(props);
window.OptimisePage = OptimisePage;
