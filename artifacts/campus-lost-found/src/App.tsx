import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  Mail,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type ReportKind = 'lost' | 'found';
type ReportStatus = 'open' | 'reunited';

interface Report {
  id: string;
  kind: ReportKind;
  itemName: string;
  category: string;
  description: string;
  location: string;
  date: string;
  contact: string;
  status: ReportStatus;
  createdAt: string;
}

const STORAGE_KEY = 'campus-lost-found-reports-v1';
const categories = ['Accessories', 'Bags', 'Books & notes', 'Clothing', 'Electronics', 'Keys & cards', 'Other'];

function dateOffset(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

const illustrativeReports: Report[] = [
  {
    id: 'seed-navy-tote',
    kind: 'lost',
    itemName: 'Navy canvas tote',
    category: 'Bags',
    description: 'A dark blue tote with a small stitched sunflower near the pocket. My studio sketchbook is inside.',
    location: 'Arts Building, room 204',
    date: dateOffset(0),
    contact: 'elena.morris@example.edu',
    status: 'open',
    createdAt: new Date(Date.now() - 1000 * 60 * 34).toISOString(),
  },
  {
    id: 'seed-silver-keys',
    kind: 'found',
    itemName: 'Set of silver keys',
    category: 'Keys & cards',
    description: 'Three keys on a green woven loop. Turned in at the front desk after my 10 a.m. lecture.',
    location: 'Morrow Library, front desk',
    date: dateOffset(0),
    contact: 'jonah.lee@example.edu',
    status: 'open',
    createdAt: new Date(Date.now() - 1000 * 60 * 83).toISOString(),
  },
  {
    id: 'seed-earbuds',
    kind: 'lost',
    itemName: 'Wireless earbuds case',
    category: 'Electronics',
    description: 'White charging case with a tiny blue tape mark on the hinge. The earbuds are inside.',
    location: 'North Quad, near the fountain',
    date: dateOffset(1),
    contact: 'riley.parker@example.edu',
    status: 'open',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(),
  },
  {
    id: 'seed-red-scarf',
    kind: 'found',
    itemName: 'Rust-red knit scarf',
    category: 'Clothing',
    description: 'Soft hand-knit scarf left over a chair. Ask me for the small detail on one end to confirm it is yours.',
    location: 'Cedar Hall café',
    date: dateOffset(2),
    contact: 'samira.ahmed@example.edu',
    status: 'open',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 28).toISOString(),
  },
  {
    id: 'seed-calculus-book',
    kind: 'lost',
    itemName: 'Calculus notebook',
    category: 'Books & notes',
    description: 'Green spiral notebook, lots of worked examples and a name written inside the front cover.',
    location: 'Science Center, lecture hall B',
    date: dateOffset(3),
    contact: 'milo.kim@example.edu',
    status: 'open',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 51).toISOString(),
  },
  {
    id: 'seed-water-bottle',
    kind: 'found',
    itemName: 'Sage metal water bottle',
    category: 'Other',
    description: 'Insulated bottle with a few small stickers. It is safe with the student union welcome desk.',
    location: 'Student Union, welcome desk',
    date: dateOffset(4),
    contact: 'avery.bell@example.edu',
    status: 'open',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
  },
];

function readReports(): Report[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Report[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // If browser storage is unavailable, the bulletin still works for this visit.
  }
  return illustrativeReports;
}

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(date);
}

function formatRelative(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function Home() {
  const [reports, setReports] = useState<Report[]>(readReports);
  const [kindFilter, setKindFilter] = useState<'all' | ReportKind>('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | 'reunited'>('open');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [toast, setToast] = useState('');
  const [draftKind, setDraftKind] = useState<ReportKind>('lost');
  const [draftCategory, setDraftCategory] = useState('Accessories');
  const [draftDate, setDraftDate] = useState(dateOffset(0));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
    } catch {
      // Keep the current session usable if this browser blocks local storage.
    }
  }, [reports]);

  useEffect(() => {
    if (!isFormOpen && !selectedReport) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFormOpen(false);
        setSelectedReport(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFormOpen, selectedReport]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const filteredReports = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...reports]
      .filter((report) => kindFilter === 'all' || report.kind === kindFilter)
      .filter((report) => statusFilter === 'all' || report.status === statusFilter)
      .filter((report) => categoryFilter === 'all' || report.category === categoryFilter)
      .filter((report) => {
        if (!normalizedQuery) return true;
        return [report.itemName, report.category, report.description, report.location]
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [reports, kindFilter, statusFilter, categoryFilter, query]);

  const openCount = reports.filter((report) => report.status === 'open').length;

  function openCreateForm() {
    setDraftKind('lost');
    setDraftCategory('Accessories');
    setDraftDate(dateOffset(0));
    setIsFormOpen(true);
  }

  function createReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const report: Report = {
      id: `report-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      kind: draftKind,
      itemName: String(form.get('itemName')).trim(),
      category: draftCategory,
      description: String(form.get('description')).trim(),
      location: String(form.get('location')).trim(),
      date: draftDate,
      contact: String(form.get('contact')).trim(),
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    setReports((current) => [report, ...current]);
    setIsFormOpen(false);
    setKindFilter('all');
    setStatusFilter('open');
    setCategoryFilter('all');
    setQuery('');
    setToast('Your report is on this browser’s bulletin.');
  }

  function updateStatus(report: Report) {
    const nextStatus: ReportStatus = report.status === 'open' ? 'reunited' : 'open';
    const updated = { ...report, status: nextStatus };
    setReports((current) => current.map((entry) => entry.id === report.id ? updated : entry));
    setSelectedReport(updated);
    setToast(nextStatus === 'reunited' ? 'Marked reunited. Thanks for closing the loop.' : 'Report moved back to open.');
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Foundit home">
          <span className="brand-mark"><Compass size={21} strokeWidth={1.8} /></span>
          <span><span className="brand-name">Foundit</span><span className="brand-sub">Campus lost &amp; found</span></span>
        </a>
        <div className="nav-right">
          <span className="local-note"><ShieldCheck size={15} /> Reports stay on this browser</span>
          <button className="button-primary" onClick={openCreateForm} data-testid="button-create-report">
            <Plus size={16} /> Post a report
          </button>
        </div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy-wrap">
          <div className="eyebrow">Look out for each other</div>
          <h1 id="hero-title">Lost something?<br />Let’s bring it <em>home.</em></h1>
          <p className="hero-copy">A clear, kind place to post the things that go missing between class, coffee, and the walk back home.</p>
        </div>
        <aside className="hero-aside" aria-label="How the campus bulletin works">
          <div className="aside-kicker">The campus bulletin</div>
          <h2>Small things find their way back.</h2>
          <p>Share the details. Reach out directly. Close the loop when you’re reunited.</p>
          <BadgeCheck className="aside-spark" size={29} strokeWidth={1.4} />
        </aside>
      </section>

      <section className="board-wrap" aria-labelledby="board-title">
        <div className="board">
          <div className="board-heading">
            <div>
              <div className="eyebrow">Around campus</div>
              <h2 id="board-title">The latest reports</h2>
              <p className="board-subtitle">Illustrative starter reports · A little more detail can make all the difference.</p>
            </div>
            <span className="report-count" data-testid="text-report-count">{openCount} open {openCount === 1 ? 'report' : 'reports'}</span>
          </div>

          <div className="toolbar" role="search">
            <label className="search-box">
              <Search size={17} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search item, details, or place"
                aria-label="Search reports"
                data-testid="input-search-reports"
              />
            </label>
            <div className="filter-tabs" aria-label="Filter by report type">
              {(['all', 'lost', 'found'] as const).map((filter) => (
                <button
                  key={filter}
                  className={`filter-tab${kindFilter === filter ? ' active' : ''}`}
                  onClick={() => setKindFilter(filter)}
                  aria-pressed={kindFilter === filter}
                  data-testid={`filter-kind-${filter}`}
                >
                  {filter === 'all' ? 'All' : filter === 'lost' ? 'Lost' : 'Found'}
                </button>
              ))}
            </div>
            <label className="select-wrap">
              <span className="sr-only">Category</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} data-testid="select-category-filter">
                <option value="all">All categories</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
              <ChevronDown size={14} />
            </label>
            <label className="select-wrap">
              <span className="sr-only">Report status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'open' | 'all' | 'reunited')} data-testid="select-status-filter">
                <option value="open">Open reports</option>
                <option value="all">All statuses</option>
                <option value="reunited">Reunited</option>
              </select>
              <ChevronDown size={14} />
            </label>
          </div>

          <div className="reports-grid" data-testid="list-reports">
            {filteredReports.length ? filteredReports.map((report, index) => (
              <article className="report-card" key={report.id} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }} data-testid={`card-report-${report.id}`}>
                <div className="card-top">
                  <span className={`kind-chip ${report.kind}`}>{report.kind === 'lost' ? 'Lost item' : 'Found item'}</span>
                  <span className={`status-small${report.status === 'reunited' ? ' reunited' : ''}`} data-testid={`status-report-${report.id}`}>{report.status === 'reunited' ? 'Reunited' : 'Open'}</span>
                </div>
                <h3 className="item-title" data-testid={`text-item-name-${report.id}`}>{report.itemName}</h3>
                <p className="item-description">{report.description}</p>
                <div className="card-meta">
                  <span><MapPin size={12} />{report.location}</span>
                  <span><CalendarDays size={12} />{formatDate(report.date)}</span>
                </div>
                <div className="card-bottom">
                  <span className="category-tag">{report.category} · {formatRelative(report.createdAt)}</span>
                  <button className="view-link" onClick={() => setSelectedReport(report)} data-testid={`button-view-report-${report.id}`}>
                    Details <ArrowUpRight size={14} />
                  </button>
                </div>
              </article>
            )) : (
              <div className="empty-state" data-testid="empty-reports">
                <div className="empty-mark"><CircleHelp size={21} /></div>
                <h3>{query ? 'No matches just yet.' : statusFilter === 'reunited' ? 'No reunited reports here.' : 'Nothing on the board yet.'}</h3>
                <p>{query ? 'Try a different item, detail, or campus spot.' : 'Be the first to add a clear report for someone on campus.'}</p>
                {query ? (
                  <button className="button-outline" onClick={() => setQuery('')} data-testid="button-clear-search">Clear search</button>
                ) : (
                  <button className="button-primary" onClick={openCreateForm} data-testid="button-empty-create"><Plus size={15} /> Post a report</button>
                )}
              </div>
            )}
          </div>
          <div className="bottom-note" data-testid="text-storage-note">
            <ShieldCheck size={15} /> This is a local bulletin: reports are saved only in this browser and are not shared with other devices.
          </div>
        </div>
      </section>

      <footer className="footer">
        <span><strong>Foundit</strong> · A small act of looking out.</span>
        <span>Need a hand? Start with the details, then reach out kindly.</span>
      </footer>

      {isFormOpen && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsFormOpen(false); }}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-title" data-testid="dialog-create-report">
            <div className="dialog-header">
              <div>
                <div className="eyebrow">Add to the bulletin</div>
                <h2 id="create-title" className="dialog-heading">What went missing?</h2>
                <p className="dialog-subtitle">A useful detail or exact campus spot helps the right person recognize it.</p>
              </div>
              <button className="close-button" onClick={() => setIsFormOpen(false)} aria-label="Close form" data-testid="button-close-create"><X size={17} /></button>
            </div>
            <form onSubmit={createReport} data-testid="form-create-report">
              <div className="field wide" style={{ marginBottom: 14 }}>
                <label>Is it lost or found?</label>
                <div className="type-select">
                  <button type="button" className={`type-choice${draftKind === 'lost' ? ' selected lost-choice' : ''}`} onClick={() => setDraftKind('lost')} aria-pressed={draftKind === 'lost'} data-testid="button-kind-lost">I lost something</button>
                  <button type="button" className={`type-choice${draftKind === 'found' ? ' selected' : ''}`} onClick={() => setDraftKind('found')} aria-pressed={draftKind === 'found'} data-testid="button-kind-found">I found something</button>
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="report-item">Item name</label>
                  <input id="report-item" name="itemName" placeholder="e.g. Green notebook" required maxLength={70} data-testid="input-item-name" />
                </div>
                <div className="field">
                  <label htmlFor="report-category">Category</label>
                  <select id="report-category" value={draftCategory} onChange={(event) => setDraftCategory(event.target.value)} data-testid="select-report-category">
                    {categories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </div>
                <div className="field wide">
                  <label htmlFor="report-description">Description</label>
                  <textarea id="report-description" name="description" placeholder="Color, identifying marks, or what was with it" required maxLength={400} data-testid="input-report-description" />
                </div>
                <div className="field">
                  <label htmlFor="report-location">Where was it last seen?</label>
                  <input id="report-location" name="location" placeholder="Building or campus spot" required maxLength={100} data-testid="input-report-location" />
                </div>
                <div className="field">
                  <label htmlFor="report-date">Date</label>
                  <input id="report-date" type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} required data-testid="input-report-date" />
                </div>
                <div className="field wide">
                  <label htmlFor="report-contact">How can someone reach you?</label>
                  <input id="report-contact" name="contact" type="email" placeholder="Your email address" required maxLength={120} data-testid="input-report-contact" />
                </div>
              </div>
              <div className="form-footer">
                <span className="form-hint">Saved on this browser only.<br />Use a campus email if you can.</span>
                <button className="button-primary" type="submit" data-testid="button-submit-report"><Plus size={15} /> Post report</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {selectedReport && (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedReport(null); }}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="detail-title" data-testid={`dialog-report-${selectedReport.id}`}>
            <div className="dialog-header detail-header">
              <div>
                <span className={`kind-chip ${selectedReport.kind}`}>{selectedReport.kind === 'lost' ? 'Lost item' : 'Found item'}</span>
                <h2 id="detail-title" className="detail-title">{selectedReport.itemName}</h2>
                <span className="detail-category">{selectedReport.category} · Posted {formatRelative(selectedReport.createdAt)}</span>
              </div>
              <button className="close-button" onClick={() => setSelectedReport(null)} aria-label="Close details" data-testid="button-close-details"><X size={17} /></button>
            </div>
            <p className="detail-body">{selectedReport.description}</p>
            <div className="detail-facts">
              <div className="detail-fact"><MapPin size={15} /><span><span className="fact-label">Campus spot</span><span className="fact-value">{selectedReport.location}</span></span></div>
              <div className="detail-fact"><CalendarDays size={15} /><span><span className="fact-label">Date</span><span className="fact-value">{formatDate(selectedReport.date)}</span></span></div>
              <div className="detail-fact"><Clock3 size={15} /><span><span className="fact-label">Report status</span><span className="fact-value">{selectedReport.status === 'open' ? 'Still looking' : 'Reunited'}</span></span></div>
              <div className="detail-fact"><Mail size={15} /><span><span className="fact-label">Reach out</span><span className="fact-value">{selectedReport.contact}</span></span></div>
            </div>
            <div className="detail-actions">
              <a className="button-primary" href={`mailto:${encodeURIComponent(selectedReport.contact)}?subject=${encodeURIComponent(`Foundit: ${selectedReport.itemName}`)}`} data-testid={`link-contact-poster-${selectedReport.id}`}>
                <Mail size={15} /> Contact poster <ArrowRight size={14} />
              </a>
              <button className="button-outline button-reunited" onClick={() => updateStatus(selectedReport)} data-testid={`button-toggle-status-${selectedReport.id}`}>
                {selectedReport.status === 'open' ? <><Check size={15} /> Mark reunited</> : <><ArrowRight size={15} /> Reopen report</>}
              </button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast-message" role="status" data-testid="status-toast"><Check size={16} />{toast}</div>}
    </main>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
