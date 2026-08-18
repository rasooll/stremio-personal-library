import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import './styles.css';

type View = 'dashboard' | 'libraries' | 'content' | 'unresolved' | 'scans';
type Library = { id: number; name: string; local_path: string; public_base_url: string; enabled: number; last_scanned_at: string | null; file_count: number };
type Content = { id: number; relative_path: string; file_type: string; status: string; library_name: string; media_type?: string; title?: string; year?: number; imdb_id?: string; tmdb_id?: number; season?: number; episode?: number; subtitle_language?: string; match_method?: string; manual_override?: number; unresolved_reason?: string };

function App() {
  const [view, setView] = useState<View>((location.hash.slice(1) as View) || 'dashboard');
  const [error, setError] = useState('');
  const navigate = (next: View) => { location.hash = next; setView(next); setError(''); };
  return <div className="shell">
    <aside>
      <div className="brand"><span className="mark">P</span><div>Personal Library<small>Stremio add-on</small></div></div>
      <nav>{(['dashboard', 'libraries', 'content', 'unresolved', 'scans'] as View[]).map((item) => <button className={view === item ? 'active' : ''} onClick={() => navigate(item)} key={item}>{label(item)}</button>)}</nav>
      <form action="/auth/logout" method="post"><button className="logout">Sign out</button></form>
    </aside>
    <main>{error && <div className="error">{error}</div>}{view === 'dashboard' && <Dashboard fail={setError} />}{view === 'libraries' && <Libraries fail={setError} />}{view === 'content' && <ContentList fail={setError} />}{view === 'unresolved' && <ContentList unresolved fail={setError} />}{view === 'scans' && <Scans fail={setError} />}</main>
  </div>;
}

function Dashboard({ fail }: { fail: (message: string) => void }) {
  const [data, setData] = useState<any>();
  useEffect(() => { api('/dashboard').then(setData).catch((error: Error) => fail(error.message)); }, []);
  const fileCount = (type: string, status?: string) => data?.fileCounts?.filter((row: any) => row.file_type === type && (!status || row.status === status)).reduce((sum: number, row: any) => sum + Number(row.count), 0) ?? 0;
  const mediaCount = (type: string) => Number(data?.mediaCounts?.find((row: any) => row.type === type)?.count ?? 0);
  const cards = [['Movies', mediaCount('movie')], ['Series', mediaCount('series')], ['Episodes', data?.episodes ?? 0], ['Video files', fileCount('video')], ['Subtitles', fileCount('subtitle')], ['Unresolved', data?.fileCounts?.filter((r: any) => r.status === 'unresolved').reduce((s: number, r: any) => s + Number(r.count), 0) ?? 0], ['Missing', data?.fileCounts?.filter((r: any) => r.status === 'missing').reduce((s: number, r: any) => s + Number(r.count), 0) ?? 0]];
  return <><Header title="Dashboard" subtitle="Library health at a glance" /><section className="cards">{cards.map(([name, value]) => <article className="card" key={name}><span>{name}</span><strong>{value}</strong></article>)}</section><section className="panel"><h2>Last scan</h2>{data?.latestScan ? <ScanSummary scan={data.latestScan} /> : <p className="muted">No scans have run yet.</p>}</section></>;
}

function Libraries({ fail }: { fail: (message: string) => void }) {
  const empty = { name: '', localPath: '', publicBaseUrl: '', enabled: true };
  const [rows, setRows] = useState<Library[]>([]); const [form, setForm] = useState(empty); const [editing, setEditing] = useState<number | null>(null); const [busy, setBusy] = useState(false);
  const load = () => api<Library[]>('/libraries').then(setRows).catch((error: Error) => fail(error.message));
  useEffect(() => { void load(); }, []);
  async function save(event: React.FormEvent) { event.preventDefault(); setBusy(true); try { await api(`/libraries${editing ? `/${editing}` : ''}`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(form) }); setForm(empty); setEditing(null); await load(); } catch (error) { fail((error as Error).message); } finally { setBusy(false); } }
  async function scan(id: number) { try { await api(`/libraries/${id}/scan`, { method: 'POST' }); location.hash = 'scans'; location.reload(); } catch (error) { fail((error as Error).message); } }
  return <><Header title="Libraries" subtitle="Read-only paths and their public media URLs" /><section className="panel"><h2>{editing ? 'Edit library' : 'Add library'}</h2><form className="library-form" onSubmit={save}><label>Name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Movies NAS" /></label><label>Local path<input required value={form.localPath} onChange={(e) => setForm({ ...form, localPath: e.target.value })} placeholder="/media/movies" /></label><label>Public base URL<input required type="url" value={form.publicBaseUrl} onChange={(e) => setForm({ ...form, publicBaseUrl: e.target.value })} placeholder="https://files.example.com/movies" /></label><label className="check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label><div className="actions"><button className="primary" disabled={busy}>{busy ? 'Saving...' : 'Save library'}</button>{editing && <button type="button" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>}</div></form></section><section className="panel table-wrap"><table><thead><tr><th>Library</th><th>Local path</th><th>Public URL</th><th>Files</th><th>Last scan</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><b>{row.name}</b><small className={row.enabled ? 'ok' : 'muted'}>{row.enabled ? 'Enabled' : 'Disabled'}</small></td><td><code>{row.local_path}</code></td><td><code>{row.public_base_url}</code></td><td>{row.file_count}</td><td>{date(row.last_scanned_at)}</td><td className="row-actions"><button onClick={() => scan(row.id)}>Update</button><button onClick={() => { setEditing(row.id); setForm({ name: row.name, localPath: row.local_path, publicBaseUrl: row.public_base_url, enabled: Boolean(row.enabled) }); }}>Edit</button><button className="danger" onClick={async () => { if (confirm('Delete this library database record? Media files will not be touched.')) { await api(`/libraries/${row.id}`, { method: 'DELETE' }); load(); } }}>Delete</button></td></tr>)}</tbody></table></section></>;
}

function ContentList({ unresolved = false, fail }: { unresolved?: boolean; fail: (message: string) => void }) {
  const [rows, setRows] = useState<Content[]>([]); const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [selected, setSelected] = useState<Content | null>(null);
  const load = () => api<Content[]>(`${unresolved ? '/unresolved' : '/content'}${!unresolved ? `?search=${encodeURIComponent(search)}&status=${status}` : ''}`).then(setRows).catch((error: Error) => fail(error.message));
  useEffect(() => { void load(); }, [unresolved]);
  return <><Header title={unresolved ? 'Unresolved' : 'Content'} subtitle={unresolved ? 'Fix uncertain matches without touching media files' : 'Search and inspect all discovered files'} /><section className="toolbar"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search paths and titles" />{!unresolved && <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option><option>matched</option><option>unresolved</option><option>missing</option></select>}<button onClick={load}>Search</button></section><section className="panel table-wrap"><table><thead><tr><th>File</th><th>Match</th><th>Episode</th><th>Status</th><th>Method</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><b>{row.relative_path.split('/').at(-1)}</b><small>{row.library_name} / {row.relative_path}</small></td><td>{row.title || <span className="muted">Not matched</span>}<small>{row.imdb_id || row.unresolved_reason}</small></td><td>{row.season != null ? `S${row.season}E${row.episode}` : '—'}</td><td><span className={`badge ${row.status}`}>{row.status}</span></td><td>{row.match_method || '—'}{row.manual_override ? <small>Override locked</small> : null}</td><td><button onClick={() => setSelected(row)}>{row.status === 'unresolved' ? 'Resolve' : 'Edit'}</button></td></tr>)}</tbody></table>{!rows.length && <p className="empty">No files found.</p>}</section>{selected && <MappingDialog row={selected} close={() => setSelected(null)} saved={() => { setSelected(null); load(); }} fail={fail} />}</>;
}

function MappingDialog({ row, close, saved, fail }: { row: Content; close: () => void; saved: () => void; fail: (message: string) => void }) {
  const [form, setForm] = useState({ type: row.media_type || 'movie', imdbId: row.imdb_id || '', tmdbId: row.tmdb_id ? String(row.tmdb_id) : '', title: row.title || '', year: row.year ? String(row.year) : '', season: row.season != null ? String(row.season) : '', episode: row.episode != null ? String(row.episode) : '', subtitleLanguage: row.subtitle_language || '' });
  async function submit(event: React.FormEvent) { event.preventDefault(); try { await api(`/files/${row.id}/mapping`, { method: 'PUT', body: JSON.stringify({ type: form.type, imdbId: form.imdbId || undefined, tmdbId: form.tmdbId ? Number(form.tmdbId) : undefined, title: form.title || undefined, year: form.year ? Number(form.year) : undefined, season: form.season ? Number(form.season) : undefined, episode: form.episode ? Number(form.episode) : undefined, subtitleLanguage: form.subtitleLanguage || undefined }) }); saved(); } catch (error) { fail((error as Error).message); } }
  return <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && close()}><form className="dialog" onSubmit={submit}><h2>Manual mapping</h2><p className="muted">{row.relative_path}</p><div className="form-grid"><label>Media type<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="movie">Movie</option><option value="series">Series</option></select></label><label>IMDb ID<input value={form.imdbId} onChange={(e) => setForm({ ...form, imdbId: e.target.value })} placeholder="tt0816692" /></label><label>TMDB ID<input type="number" value={form.tmdbId} onChange={(e) => setForm({ ...form, tmdbId: e.target.value })} /></label><label>Title override<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label>Year<input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></label><label>Season<input type="number" value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} /></label><label>Episode<input type="number" value={form.episode} onChange={(e) => setForm({ ...form, episode: e.target.value })} /></label><label>Subtitle language<input value={form.subtitleLanguage} onChange={(e) => setForm({ ...form, subtitleLanguage: e.target.value })} placeholder="eng" /></label></div><div className="actions"><button className="primary">Verify and save</button><button type="button" onClick={close}>Cancel</button>{row.manual_override ? <button type="button" className="danger" onClick={async () => { if (confirm('Discard the manual override and re-run matching on the next library update?')) { await api(`/files/${row.id}/rematch`, { method: 'POST' }); saved(); } }}>Re-run automatic matching</button> : null}</div></form></div>;
}

function Scans({ fail }: { fail: (message: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { const load = () => api<any[]>('/scans').then(setRows).catch((error: Error) => fail(error.message)); load(); const timer = setInterval(load, 2500); return () => clearInterval(timer); }, []);
  return <><Header title="Scan History" subtitle="Incremental work and external request metrics" /><section className="panel table-wrap"><table><thead><tr><th>Library / time</th><th>Status</th><th>Discovered</th><th>New / changed / skipped</th><th>Matched / unresolved</th><th>TMDB / AI</th><th>Errors</th></tr></thead><tbody>{rows.map((scan) => <tr key={scan.id}><td><b>{scan.library_name || 'Deleted library'}</b><small>{date(scan.started_at)} · {duration(scan.started_at, scan.finished_at)}</small></td><td><span className={`badge ${scan.status}`}>{scan.status}</span></td><td>{scan.discovered_count}</td><td>{scan.new_count} / {scan.changed_count} / {scan.skipped_count}</td><td>{scan.matched_count} / {scan.unresolved_count}</td><td>{scan.tmdb_request_count} / {scan.ai_request_count}</td><td>{scan.error_count}</td></tr>)}</tbody></table></section></>;
}

function Header({ title, subtitle }: { title: string; subtitle: string }) { return <header><h1>{title}</h1><p>{subtitle}</p></header>; }
function ScanSummary({ scan }: { scan: any }) { return <div className="scan-summary"><span><b>{scan.status}</b>Status</span><span><b>{scan.discovered_count}</b>Discovered</span><span><b>{scan.skipped_count}</b>Skipped</span><span><b>{scan.tmdb_request_count}</b>TMDB calls</span><span><b>{scan.ai_request_count}</b>AI calls</span></div>; }
function label(view: string) { return (view[0] ?? '').toUpperCase() + view.slice(1); }
function date(value: string | null) { return value ? new Date(value).toLocaleString() : 'Never'; }
function duration(start: string, end?: string) { return end ? `${Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000))}s` : 'Running'; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
