// Trip summary — stats + export
function SummaryPage({ navigate, params }) {
  const toast = RFUI.useToast();
  const [trip, setTrip] = React.useState(null);

  React.useEffect(() => {
    const t = RF.getTrip(params?.tripId);
    if (!t) { toast('Trip not found', 'error'); navigate('dashboard'); return; }
    setTrip(t);
  }, [params?.tripId]);

  if (!trip) return <div className="page"><div className="skel" style={{ height: 200 }}></div></div>;
  const stops = trip.optimised || [];
  const walkStops = stops.filter((s) => s.mode === 'walking').length;
  const driveStops = stops.filter((s) => s.mode === 'driving').length;
  const totalTime = stops.reduce((a, s) => a + s.selectedTime, 0);
  const drivingOnly = stops.reduce((a, s) => a + s.drivingTime, 0);

  function exportCSV() {
    const rows = [['Sequence', 'Postcode', 'Mode', 'Distance (km)', 'Time (min)', 'ETA']];
    stops.forEach((s) => rows.push([s.sequence, s.postcode, s.mode, s.distanceFromPrevious, s.selectedTime, s.arrivalTime]));
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${trip.name}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast('CSV downloaded', 'success');
  }

  return (
    <div className="page fade-in">
      <button className="btn btn-ghost btn-sm" onClick={() => navigate('dashboard')} style={{ marginBottom: 12 }}>
        <I.ArrowLeft size={14} /> Dashboard
      </button>
      <div className="page-head">
        <div>
          <div className="page-title">{trip.name}</div>
          <div className="page-sub">
            {new Date(trip.date).toLocaleString()} · <span className={`chip ${trip.status === 'completed' ? 'chip-walk' : 'chip-accent'}`} style={{ marginLeft: 6 }}>{trip.status}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={exportCSV}><I.Download size={14} /> CSV</button>
          <button className="btn btn-secondary" onClick={() => toast('PDF export coming soon', 'info')}><I.File size={14} /> PDF</button>
        </div>
      </div>

      <div className="kpi-grid">
        <Kpi label="Total stops" value={stops.length} ico={I.PinDrop} />
        <Kpi label="Distance" value={`${trip.totalDistance}km`} ico={I.TrendUp} />
        <Kpi label="Time saved" value={`${Math.round(trip.timeSaved)}m`} ico={I.Clock} delta="vs. drive-only" up />
        <Kpi label="Total time" value={`${totalTime}m`} ico={I.Activity} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24, marginTop: 28 }} className="sum-grid">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="fw-600">Route map</div>
            <div className="text-xs text-secondary">{stops.length} stops · nearest-neighbour</div>
          </div>
          <RFUI.FakeMap stops={stops} height={360} withLabels />
        </div>

        <div className="card">
          <div className="fw-600 mb-4">Mode split</div>
          <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', background: 'var(--color-surface-2)' }}>
            <div style={{ width: `${(walkStops / Math.max(1, stops.length)) * 100}%`, background: 'var(--color-walk)' }}></div>
            <div style={{ width: `${(driveStops / Math.max(1, stops.length)) * 100}%`, background: 'var(--color-drive)' }}></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13 }}>
            <div><span className="chip chip-walk"><I.Walk size={11} /> Walked</span> <span className="mono fw-600 ml-2" style={{ marginLeft: 8 }}>{walkStops}</span></div>
            <div><span className="chip chip-drive"><I.Car size={11} /> Driven</span> <span className="mono fw-600" style={{ marginLeft: 8 }}>{driveStops}</span></div>
          </div>

          <div className="divider"></div>

          <div className="fw-600 mb-4">Comparison</div>
          <div className="flex-col gap-2">
            <CompRow label="Drive-only baseline" value={`${drivingOnly}m`} />
            <CompRow label="Hybrid actual" value={`${totalTime}m`} accent />
            <CompRow label="Saved" value={`${Math.round(trip.timeSaved)}m`} success />
          </div>
        </div>
      </div>

      <div className="card mt-6" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-border)', fontWeight: 600 }}>Stops</div>
        <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Postcode</th>
                <th>Mode</th>
                <th className="hide-mobile">Distance</th>
                <th>Time</th>
                <th className="hide-mobile">ETA</th>
              </tr>
            </thead>
            <tbody>
              {stops.map((s) => (
                <tr key={s.sequence}>
                  <td className="mono text-secondary">{s.sequence}</td>
                  <td className="mono fw-600">{s.postcode}</td>
                  <td><span className={`chip ${s.mode === 'walking' ? 'chip-walk' : 'chip-drive'}`}>{s.mode === 'walking' ? <I.Walk size={11} /> : <I.Car size={11} />}{s.mode}</span></td>
                  <td className="hide-mobile mono">{s.distanceFromPrevious}km</td>
                  <td className="mono">{s.selectedTime}m</td>
                  <td className="hide-mobile mono">{s.arrivalTime}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <style>{`
        @media (max-width: 1023px) { .sum-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

function Kpi({ label, value, ico, delta, up }) {
  const Ic = ico;
  return (
    <div className="kpi">
      <div className="kpi-label"><Ic className="ico" size={14} />{label}</div>
      <div className="kpi-value">{value}</div>
      {delta && <div className={`kpi-delta ${up ? 'up' : ''}`}>{delta}</div>}
    </div>
  );
}

function CompRow({ label, value, accent, success }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--color-surface-2)', borderRadius: 'var(--r-md)' }}>
      <span className="text-sm text-secondary">{label}</span>
      <span className="mono fw-700" style={{ color: success ? 'var(--color-success)' : accent ? 'var(--color-accent)' : 'inherit' }}>{value}</span>
    </div>
  );
}

window.SummaryPage = SummaryPage;
