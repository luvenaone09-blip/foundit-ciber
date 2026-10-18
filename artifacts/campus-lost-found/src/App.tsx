import { type ChangeEvent, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type User } from '@supabase/supabase-js';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { supabase } from '@/lib/supabase';
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
  ImagePlus,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
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
  ownerId?: string;
  photoPath?: string;
  photoUrl?: string;
  photoDataUrl?: string;
  status: ReportStatus;
  createdAt: string;
}

const STORAGE_KEY = 'campus-lost-found-reports-v1';
const OWNER_STORAGE_KEY = 'foundit-browser-owner-v1';
const MIGRATION_KEY = 'foundit-supabase-migration-v1';
const PHOTO_BUCKET = 'foundit-report-photos';
const categories = ['Accessories', 'Bags', 'Books & notes', 'Clothing', 'Electronics', 'Keys & cards', 'Other'];

function getBrowserOwnerId() {
  try {
    const saved = localStorage.getItem(OWNER_STORAGE_KEY);
    if (saved) return saved;
    const generated = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    localStorage.setItem(OWNER_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

function isValidContact(value: string) {
  const contact = value.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return true;
  const compactPhone = contact.replace(/[\s().-]/g, '');
  return /^\+?\d{7,15}$/.test(compactPhone);
}

function getContactLink(contact: string) {
  const normalizedContact = contact.trim();
  if (!normalizedContact) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedContact)) {
    return {
      href: `mailto:${encodeURIComponent(normalizedContact)}`,
      label: 'Email poster',
      channel: 'email' as const,
    };
  }
  return {
    href: `tel:${normalizedContact.replace(/[^\d+]/g, '')}`,
    label: 'Call poster',
    channel: 'phone' as const,
  };
}

interface ReportRow {
  id: string;
  owner_id: string;
  kind: ReportKind;
  item_name: string;
  category: string;
  description: string;
  location: string;
  date: string;
  contact: string;
  photo_path: string | null;
  status: ReportStatus;
  created_at: string;
}

function reportFromRow(row: ReportRow, photoUrl?: string): Report {
  return {
    id: row.id,
    ownerId: row.owner_id,
    kind: row.kind,
    itemName: row.item_name,
    category: row.category,
    description: row.description,
    location: row.location,
    date: row.date,
    contact: row.contact,
    photoPath: row.photo_path ?? undefined,
    photoUrl,
    status: row.status,
    createdAt: row.created_at,
  };
}

function reportToRow(report: Report, ownerId: string, photoPath: string | null) {
  return {
    id: report.id,
    owner_id: ownerId,
    kind: report.kind,
    item_name: report.itemName,
    category: report.category,
    description: report.description,
    location: report.location,
    date: report.date,
    contact: report.contact,
    photo_path: photoPath,
    status: report.status,
    created_at: report.createdAt,
  };
}

function getLegacyReports(): Report[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const browserOwnerId = getBrowserOwnerId();
    if (!saved) return [];
    const parsed = JSON.parse(saved) as Report[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((report) => (
      typeof report.id === 'string' &&
      report.id.startsWith('report-') &&
      (!report.ownerId || report.ownerId === browserOwnerId)
    ));
  } catch {
    return [];
  }
}

async function uploadReportPhoto(dataUrl: string, path: string) {
  const blob = await (await fetch(dataUrl)).blob();
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
}

async function migrateLegacyReports(userId: string) {
  try {
    if (localStorage.getItem(MIGRATION_KEY)) return;
  } catch {
    return;
  }

  for (const report of getLegacyReports()) {
    let photoPath = report.photoPath ?? null;
    if (report.photoDataUrl) {
      photoPath = `${userId}/${report.id}/legacy.jpg`;
      await uploadReportPhoto(report.photoDataUrl, photoPath);
    }
    const { error } = await supabase
      .from('reports')
      .upsert(reportToRow(report, userId, photoPath), { onConflict: 'id' });
    if (error) throw error;
  }

  try {
    localStorage.setItem(MIGRATION_KEY, 'done');
  } catch {
    // If storage is disabled, stable report IDs make a later retry safe.
  }
}

async function compressPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 960;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');

  if (!context) {
    bitmap.close();
    throw new Error('Could not prepare the photo.');
  }

  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const canvasToJpeg = (source: HTMLCanvasElement, quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      source.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Could not encode the photo.')),
        'image/jpeg',
        quality,
      );
    });

  let blob = await canvasToJpeg(canvas, 0.72);

  if (blob.size > 320 * 1024) {
    const smallerCanvas = document.createElement('canvas');
    const smallerScale = Math.min(1, 720 / Math.max(canvas.width, canvas.height));
    smallerCanvas.width = Math.max(1, Math.round(canvas.width * smallerScale));
    smallerCanvas.height = Math.max(1, Math.round(canvas.height * smallerScale));
    const smallerContext = smallerCanvas.getContext('2d');
    if (!smallerContext) throw new Error('Could not resize the photo.');
    smallerContext.fillStyle = '#fff';
    smallerContext.fillRect(0, 0, smallerCanvas.width, smallerCanvas.height);
    smallerContext.drawImage(canvas, 0, 0, smallerCanvas.width, smallerCanvas.height);
    blob = await canvasToJpeg(smallerCanvas, 0.58);
  }

  if (blob.size > 320 * 1024) throw new Error('The photo is too large to save in this browser.');

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Could not read the photo.'));
    reader.onerror = () => reject(new Error('Could not read the photo.'));
    reader.readAsDataURL(blob);
  });
}

function dateOffset(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
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

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unknown error';
}

function Home({
  user,
  authError,
  authOpen,
  setAuthOpen,
}: {
  user: User | null;
  authError: string;
  authOpen: boolean;
  setAuthOpen: (open: boolean) => void;
}) {
  const [reports, setReports] = useState<Report[]>([]);
  const [kindFilter, setKindFilter] = useState<'all' | ReportKind>('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | 'reunited'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [toast, setToast] = useState('');
  const [draftKind, setDraftKind] = useState<ReportKind>('lost');
  const [draftCategory, setDraftCategory] = useState('Accessories');
  const [draftDate, setDraftDate] = useState(dateOffset(0));
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [retainedPhotoPath, setRetainedPhotoPath] = useState<string | null>(null);
  const [retainedPhotoUrl, setRetainedPhotoUrl] = useState<string | null>(null);
  const [isPhotoProcessing, setIsPhotoProcessing] = useState(false);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [isMutatingReport, setIsMutatingReport] = useState(false);
  const [isLoadingReports, setIsLoadingReports] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  useEffect(() => {
    if (user) return;
    setIsFormOpen(false);
    setEditingReport(null);
    setPhotoDataUrl(null);
    setRetainedPhotoPath(null);
    setRetainedPhotoUrl(null);
  }, [user?.id]);

  const refreshReports = useCallback(async () => {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    let photoFailures = 0;
    const refreshed = await Promise.all(((data ?? []) as ReportRow[]).map(async (row) => {
      if (!row.photo_path) return reportFromRow(row);
      const { data: signedPhoto, error: photoError } = await supabase
        .storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(row.photo_path, 60 * 60);
      if (photoError) {
        photoFailures += 1;
        return reportFromRow(row);
      }
      return reportFromRow(row, signedPhoto.signedUrl);
    }));

    setReports(refreshed);
    setSelectedReport((current) => current
      ? refreshed.find((report) => report.id === current.id) ?? null
      : null);
    setLoadError('');
    if (photoFailures) {
      setToast(`${photoFailures} report photo${photoFailures === 1 ? '' : 's'} could not be loaded.`);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadInitialReports = async () => {
      setIsLoadingReports(true);
      try {
        if (user) await migrateLegacyReports(user.id);
        await refreshReports();
      } catch (error) {
        if (active) setLoadError(`Could not load shared reports: ${errorText(error)}`);
      } finally {
        if (active) setIsLoadingReports(false);
      }
    };

    void loadInitialReports();
    const channel = supabase
      .channel(`foundit-reports-${user?.id ?? 'public'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, () => {
        void refreshReports().catch((error) => {
          if (active) setLoadError(`Live refresh failed: ${errorText(error)}`);
        });
      })
      .subscribe((status) => {
        if (!active) return;
        setRealtimeStatus(status === 'SUBSCRIBED'
          ? 'connected'
          : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED'
            ? 'disconnected'
            : 'connecting');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setToast('Live updates are unavailable. Reports can still be refreshed.');
        }
      });
    const photoRefreshTimer = window.setInterval(() => {
      void refreshReports().catch((error) => {
        if (active) setLoadError(`Report refresh failed: ${errorText(error)}`);
      });
    }, 50 * 60 * 1000);

    return () => {
      active = false;
      window.clearInterval(photoRefreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [user?.id, refreshReports]);

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
  const selectedContact = selectedReport ? getContactLink(selectedReport.contact) : null;

  function openCreateForm() {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    setEditingReport(null);
    setDraftKind('lost');
    setDraftCategory('Accessories');
    setDraftDate(dateOffset(0));
    setPhotoDataUrl(null);
    setRetainedPhotoPath(null);
    setRetainedPhotoUrl(null);
    setIsFormOpen(true);
  }

  function openEditForm(report: Report) {
    if (!user) return;
    if (report.ownerId !== user.id) return;
    setEditingReport(report);
    setDraftKind(report.kind);
    setDraftCategory(report.category);
    setDraftDate(report.date);
    setPhotoDataUrl(report.photoDataUrl ?? null);
    setRetainedPhotoPath(report.photoPath ?? null);
    setRetainedPhotoUrl(report.photoUrl ?? null);
    setSelectedReport(null);
    setIsFormOpen(true);
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setToast('Choose a JPG, PNG, or WebP photo.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setToast('Choose a photo smaller than 10 MB.');
      return;
    }

    setIsPhotoProcessing(true);
    try {
      setPhotoDataUrl(await compressPhoto(file));
      setRetainedPhotoPath(null);
      setRetainedPhotoUrl(null);
      setToast('Photo added to your report.');
    } catch {
      setToast('Could not prepare that photo. Try a smaller JPG, PNG, or WebP image.');
    } finally {
      setIsPhotoProcessing(false);
    }
  }

  async function saveReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      setIsFormOpen(false);
      setAuthOpen(true);
      return;
    }
    if (isSavingReport) return;
    if (isPhotoProcessing) {
      setToast('Please wait while your photo is being prepared.');
      return;
    }
    const form = new FormData(event.currentTarget);
    const contact = String(form.get('contact') ?? '').trim();
    if (contact && !isValidContact(contact)) {
      setToast('Enter a valid email address or phone number.');
      return;
    }
    const existingReport = editingReport;
    const report: Report = {
      id: existingReport?.id ?? crypto.randomUUID(),
      kind: draftKind,
      itemName: String(form.get('itemName')).trim(),
      category: draftCategory,
      description: String(form.get('description')).trim(),
      location: String(form.get('location')).trim(),
      date: draftDate,
      contact,
      ownerId: user.id,
      photoPath: retainedPhotoPath ?? undefined,
      photoUrl: retainedPhotoUrl ?? undefined,
      photoDataUrl: photoDataUrl ?? undefined,
      status: existingReport?.status ?? 'open',
      createdAt: existingReport?.createdAt ?? new Date().toISOString(),
    };

    setIsSavingReport(true);
    let uploadedPhotoPath: string | null = null;
    try {
      let photoPathToSave = retainedPhotoPath;
      if (photoDataUrl) {
        uploadedPhotoPath = `${user.id}/${report.id}/${crypto.randomUUID()}.jpg`;
        await uploadReportPhoto(photoDataUrl, uploadedPhotoPath);
        photoPathToSave = uploadedPhotoPath;
      }

      const row = reportToRow(report, user.id, photoPathToSave);
      const result = existingReport
        ? await supabase.from('reports').update(row).eq('id', report.id).eq('owner_id', user.id).select('id').maybeSingle()
        : await supabase.from('reports').insert(row).select('id').single();
      if (result.error) throw result.error;
      if (!result.data) throw new Error('This report no longer exists or is not yours to edit.');

      let photoCleanupFailed = false;
      if (existingReport?.photoPath && existingReport.photoPath !== photoPathToSave) {
        const { error: cleanupError } = await supabase.storage
          .from(PHOTO_BUCKET)
          .remove([existingReport.photoPath]);
        photoCleanupFailed = Boolean(cleanupError);
      }

      setIsFormOpen(false);
      setPhotoDataUrl(null);
      setRetainedPhotoPath(null);
      setRetainedPhotoUrl(null);
      setEditingReport(null);
      setKindFilter('all');
      setStatusFilter('all');
      setCategoryFilter('all');
      setQuery('');
      try {
        await refreshReports();
        setToast(photoCleanupFailed
          ? 'Report saved, but its previous photo could not be removed.'
          : existingReport ? 'Your report was updated.' : 'Your report was shared with Ciber.');
      } catch (error) {
        setLoadError(`Report saved, but the list could not refresh: ${errorText(error)}`);
      }
    } catch (error) {
      if (uploadedPhotoPath) {
        await supabase.storage.from(PHOTO_BUCKET).remove([uploadedPhotoPath]);
      }
      setToast(`Could not save report: ${errorText(error)}`);
    } finally {
      setIsSavingReport(false);
    }
  }

  async function updateStatus(report: Report) {
    if (!user) return;
    if (report.ownerId !== user.id || isMutatingReport) return;
    const nextStatus: ReportStatus = report.status === 'open' ? 'reunited' : 'open';
    setIsMutatingReport(true);
    try {
      const { data, error } = await supabase
        .from('reports')
        .update({ status: nextStatus })
        .eq('id', report.id)
        .eq('owner_id', user.id)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This report no longer exists or is not yours to update.');
      await refreshReports();
      setToast(nextStatus === 'reunited' ? 'Marked reunited. Thanks for closing the loop.' : 'Report moved back to open.');
    } catch (error) {
      setToast(`Could not update report: ${errorText(error)}`);
    } finally {
      setIsMutatingReport(false);
    }
  }

  async function deleteReport(report: Report) {
    if (!user) return;
    if (report.ownerId !== user.id || isMutatingReport) return;
    const confirmed = window.confirm(`Delete "${report.itemName}"? This will permanently remove it from the shared Ciber bulletin.`);
    if (!confirmed) return;
    setIsMutatingReport(true);
    try {
      const { data, error } = await supabase
        .from('reports')
        .delete()
        .eq('id', report.id)
        .eq('owner_id', user.id)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This report no longer exists or is not yours to delete.');
      let photoCleanupFailed = false;
      if (report.photoPath) {
        const { error: photoError } = await supabase.storage.from(PHOTO_BUCKET).remove([report.photoPath]);
        photoCleanupFailed = Boolean(photoError);
      }
      setSelectedReport(null);
      await refreshReports();
      setToast(photoCleanupFailed
        ? 'Report deleted, but its photo could not be removed.'
        : 'Your report was deleted.');
    } catch (error) {
      setToast(`Could not delete report: ${errorText(error)}`);
    } finally {
      setIsMutatingReport(false);
    }
  }

  async function retryLoadReports() {
    setIsLoadingReports(true);
    setLoadError('');
    try {
      if (user) await migrateLegacyReports(user.id);
      await refreshReports();
    } catch (error) {
      setLoadError(`Could not load shared reports: ${errorText(error)}`);
    } finally {
      setIsLoadingReports(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Foundit home">
          <span className="brand-mark"><Compass size={21} strokeWidth={1.8} /></span>
          <span><span className="brand-name">Foundit</span><span className="brand-sub">Ciber school lost &amp; found</span></span>
        </a>
        <div className="nav-right">
          <span className="local-note"><ShieldCheck size={15} /> {realtimeStatus === 'connected' ? 'Live reports synced' : realtimeStatus === 'connecting' ? 'Connecting to live reports…' : 'Live sync unavailable'}</span>
          <AuthPopover user={user} initialError={authError} open={authOpen} setOpen={setAuthOpen} />
          <button className="button-primary" onClick={openCreateForm} data-testid="button-create-report">
            <Plus size={16} /> Post a report
          </button>
        </div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy-wrap">
          <div className="eyebrow">Look out for each other</div>
          <h1 id="hero-title">Lost something?<br />Let’s bring it <em>home.</em></h1>
          <p className="hero-copy">A clear, kind place for Ciber students to post things that go missing between classes and the walk home.</p>
        </div>
        <aside className="hero-aside" aria-label="How the Ciber school bulletin works">
          <div className="aside-kicker">The Ciber school bulletin</div>
          <h2>Small things find their way back.</h2>
          <p>Share the details. Reach out directly. Close the loop when you’re reunited.</p>
          <BadgeCheck className="aside-spark" size={29} strokeWidth={1.4} />
        </aside>
      </section>

      <section className="board-wrap" aria-labelledby="board-title">
        <div className="board">
          <div className="board-heading">
            <div>
              <div className="eyebrow">Around Ciber</div>
              <h2 id="board-title">The latest reports</h2>
              <p className="board-subtitle">Shared reports from Ciber students · A little more detail can make all the difference.</p>
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
            {loadError ? (
              <div className="empty-state" role="alert" data-testid="error-load-reports">
                <div className="empty-mark"><CircleHelp size={21} /></div>
                <h3>Reports could not be loaded.</h3>
                <p>{loadError}</p>
                <button className="button-outline" onClick={() => void retryLoadReports()} data-testid="button-retry-reports">Try again</button>
              </div>
            ) : isLoadingReports ? (
              <div className="empty-state" role="status" data-testid="status-loading-reports">
                <p>Loading shared Ciber reports…</p>
              </div>
            ) : filteredReports.length ? filteredReports.map((report, index) => (
              <article className="report-card" key={report.id} style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }} data-testid={`card-report-${report.id}`}>
                {(report.photoUrl || report.photoDataUrl) && <img className="report-photo" src={report.photoUrl ?? report.photoDataUrl} alt={report.itemName} data-testid={`img-report-${report.id}`} />}
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
                <p>{query ? 'Try a different item, detail, or school location.' : 'Be the first to add a clear report for someone at Ciber.'}</p>
                {query ? (
                  <button className="button-outline" onClick={() => setQuery('')} data-testid="button-clear-search">Clear search</button>
                ) : (
                  <button className="button-primary" onClick={openCreateForm} data-testid="button-empty-create"><Plus size={15} /> Post a report</button>
                )}
              </div>
            )}
          </div>
          <div className="bottom-note" data-testid="text-storage-note">
            <ShieldCheck size={15} /> Reports, optional contact details, and photos are public. Sign in to post or manage your own reports.
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
                <div className="eyebrow">{editingReport ? 'Update your report' : 'Add to the Ciber bulletin'}</div>
                <h2 id="create-title" className="dialog-heading">{editingReport ? 'Edit your report' : 'What went missing?'}</h2>
                <p className="dialog-subtitle">{editingReport ? 'Update the details so the right person can recognize it.' : 'A useful detail or exact school location helps the right person recognize it.'}</p>
              </div>
              <button className="close-button" onClick={() => setIsFormOpen(false)} aria-label="Close form" data-testid="button-close-create"><X size={17} /></button>
            </div>
            <form onSubmit={saveReport} data-testid="form-create-report">
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
                  <input id="report-item" name="itemName" defaultValue={editingReport?.itemName ?? ''} placeholder="e.g. Green notebook" required maxLength={70} data-testid="input-item-name" />
                </div>
                <div className="field">
                  <label htmlFor="report-category">Category</label>
                  <select id="report-category" value={draftCategory} onChange={(event) => setDraftCategory(event.target.value)} data-testid="select-report-category">
                    {categories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </div>
                <div className="field wide">
                  <label htmlFor="report-description">Description</label>
                  <textarea id="report-description" name="description" defaultValue={editingReport?.description ?? ''} placeholder="Color, identifying marks, or what was with it" required maxLength={400} data-testid="input-report-description" />
                </div>
                <div className="field">
                  <label htmlFor="report-location">Where was it last seen?</label>
                  <input id="report-location" name="location" defaultValue={editingReport?.location ?? ''} placeholder="Building or school location" required maxLength={100} data-testid="input-report-location" />
                </div>
                <div className="field">
                  <label htmlFor="report-date">Date</label>
                  <input id="report-date" type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} required data-testid="input-report-date" />
                </div>
                <div className="field wide">
                  <label className="photo-label" htmlFor="report-photo"><ImagePlus size={14} /> Add a photo <span>(optional)</span></label>
                  <input
                    id="report-photo"
                    className="photo-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handlePhotoChange}
                    disabled={isPhotoProcessing}
                    data-testid="input-report-photo"
                  />
                  <p className="photo-hint">JPG, PNG, or WebP · up to 10 MB · visible to anyone with the report</p>
                  {isPhotoProcessing && <p className="photo-processing" role="status" data-testid="status-photo-processing">Preparing photo…</p>}
                  {(photoDataUrl || retainedPhotoUrl) && (
                    <div className="photo-preview">
                      <img src={photoDataUrl ?? retainedPhotoUrl ?? undefined} alt="Preview of the selected item" data-testid="img-report-photo-preview" />
                      <button type="button" className="photo-remove" onClick={() => { setPhotoDataUrl(null); setRetainedPhotoPath(null); setRetainedPhotoUrl(null); }} data-testid="button-remove-report-photo">
                        <X size={13} /> Remove photo
                      </button>
                    </div>
                  )}
                </div>
                <div className="field wide">
                  <label htmlFor="report-contact">Contact person (optional)</label>
                  <input id="report-contact" name="contact" type="text" inputMode="text" autoCapitalize="none" defaultValue={editingReport?.contact ?? ''} placeholder="Email or phone number (optional)" maxLength={120} data-testid="input-report-contact" />
                </div>
              </div>
              <div className="form-footer">
                <span className="form-hint">Contact is optional.<br />Your report and photo will be public.</span>
                <button className="button-primary" type="submit" disabled={isPhotoProcessing || isSavingReport} data-testid="button-submit-report">
                  {isSavingReport ? 'Saving…' : editingReport ? <><Check size={15} /> Save changes</> : <><Plus size={15} /> Post report</>}
                </button>
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
            {(selectedReport.photoUrl || selectedReport.photoDataUrl) && <img className="detail-photo" src={selectedReport.photoUrl ?? selectedReport.photoDataUrl} alt={`Photo of ${selectedReport.itemName}`} data-testid={`img-detail-${selectedReport.id}`} />}
            <p className="detail-body">{selectedReport.description}</p>
            <div className="detail-facts">
              <div className="detail-fact"><MapPin size={15} /><span><span className="fact-label">School location</span><span className="fact-value">{selectedReport.location}</span></span></div>
              <div className="detail-fact"><CalendarDays size={15} /><span><span className="fact-label">Date</span><span className="fact-value">{formatDate(selectedReport.date)}</span></span></div>
              <div className="detail-fact"><Clock3 size={15} /><span><span className="fact-label">Report status</span><span className="fact-value">{selectedReport.status === 'open' ? 'Still looking' : 'Reunited'}</span></span></div>
              {selectedContact && (
                <div className="detail-fact">
                  {selectedContact.channel === 'email' ? <Mail size={15} /> : <Phone size={15} />}
                  <span><span className="fact-label">Reach out</span><span className="fact-value">{selectedReport.contact}</span></span>
                </div>
              )}
            </div>
            <div className="detail-actions">
              {selectedContact && (
                <a className="button-primary" href={selectedContact.href} data-testid={`link-contact-poster-${selectedReport.id}`}>
                  {selectedContact.channel === 'email' ? <Mail size={15} /> : <Phone size={15} />}
                  {selectedContact.label} <ArrowRight size={14} />
                </a>
              )}
              {user && selectedReport.ownerId === user.id && (
                <>
                  <button className="button-outline" disabled={isMutatingReport} onClick={() => openEditForm(selectedReport)} data-testid={`button-edit-report-${selectedReport.id}`}>
                    <Pencil size={14} /> Edit report
                  </button>
                  <button className="button-outline button-delete" disabled={isMutatingReport} onClick={() => void deleteReport(selectedReport)} data-testid={`button-delete-report-${selectedReport.id}`}>
                    <Trash2 size={14} /> Delete report
                  </button>
                  <button className="button-outline button-reunited" disabled={isMutatingReport} onClick={() => void updateStatus(selectedReport)} data-testid={`button-toggle-status-${selectedReport.id}`}>
                    {selectedReport.status === 'open' ? <><Check size={15} /> Mark reunited</> : <><ArrowRight size={15} /> Reopen report</>}
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast-message" role="status" data-testid="status-toast"><Check size={16} />{toast}</div>}
    </main>
  );
}

function AuthGate() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      setIsLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setAuthError(errorText(error));
      setIsLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setIsLoading(false);
      setAuthError('');
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (isLoading) {
    return <main className="auth-page"><div className="auth-card auth-loading" role="status">Checking your Foundit account…</div></main>;
  }
  return <Home user={session?.user ?? null} authError={authError} authOpen={authOpen} setAuthOpen={setAuthOpen} />;
}

function AuthPopover({
  user,
  initialError = '',
  open,
  setOpen,
}: {
  user?: User | null;
  initialError?: string;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(initialError);
  const [message, setMessage] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !popoverRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, setOpen]);

  useEffect(() => {
    if (!user) return;
    setOpen(false);
    setError('');
    setMessage('');
  }, [user, setOpen]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (mode === 'sign-up') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          setOpen(false);
        } else {
          setMessage('Supabase still requires email confirmation. Turn off “Confirm email” in Supabase Authentication settings for instant sign-in.');
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (submitError) {
      setError(errorText(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function signOut() {
    setError('');
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(`Could not sign out: ${signOutError.message}`);
    else setOpen(false);
  }

  function changeMode(nextMode: 'sign-in' | 'sign-up') {
    setMode(nextMode);
    setError('');
    setMessage('');
  }

  return (
    <div className="auth-popover-wrap" ref={popoverRef}>
      <button
        ref={triggerRef}
        className={user ? 'account-trigger' : 'button-primary auth-trigger'}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="foundit-auth-popover"
        onClick={() => setOpen(!open)}
        data-testid={user ? 'button-account-menu' : 'button-open-auth'}
      >
        {user ? (
          <>
            <span className="account-avatar">{(user.email?.[0] ?? 'S').toUpperCase()}</span>
            <span className="account-trigger-label">Account</span>
            <ChevronDown size={14} />
          </>
        ) : (
          <>Sign In / Sign Up <ChevronDown size={15} /></>
        )}
      </button>

      {open && (
        <section
          id="foundit-auth-popover"
          className={`auth-popover${user ? ' profile-popover' : ''}`}
          role="dialog"
          aria-label={user ? 'Account menu' : 'Sign in or create an account'}
          data-testid="popover-auth"
        >
          {user ? (
            <>
              <div className="profile-popover-heading">
                <span className="account-avatar profile-avatar">{(user.email?.[0] ?? 'S').toUpperCase()}</span>
                <div className="profile-account-copy">
                  <strong>Foundit account</strong>
                  <span>{user.email ?? 'Student account'}</span>
                </div>
              </div>
              <div className="account-status"><span className="account-status-dot" /> Account active</div>
              {error && <p className="auth-alert error" role="alert">{error}</p>}
              <button className="button-outline profile-signout" type="button" onClick={() => void signOut()} data-testid="button-sign-out">
                <LogOut size={15} /> Sign out
              </button>
            </>
          ) : (
            <>
              <div className="popover-heading">
                <div className="eyebrow">Ciber student access</div>
                <h2>{mode === 'sign-in' ? 'Welcome back.' : 'Join the bulletin.'}</h2>
                <p>Sign in once to keep your reports in sync across devices.</p>
              </div>
              <div className="auth-tabs" role="tablist" aria-label="Account access">
                <button type="button" role="tab" aria-selected={mode === 'sign-in'} className={mode === 'sign-in' ? 'active' : ''} onClick={() => changeMode('sign-in')} data-testid="tab-sign-in">Sign in</button>
                <button type="button" role="tab" aria-selected={mode === 'sign-up'} className={mode === 'sign-up' ? 'active' : ''} onClick={() => changeMode('sign-up')} data-testid="tab-sign-up">Sign up</button>
              </div>
              <form className="auth-form" onSubmit={submit} data-testid="form-auth">
                <label className="auth-field">
                  <span>Email</span>
                  <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} data-testid="input-auth-email" />
                </label>
                <label className="auth-field">
                  <span>Password</span>
                  <input type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} maxLength={72} data-testid="input-auth-password" />
                  {mode === 'sign-up' && <small>Use at least 6 characters.</small>}
                </label>
                {error && <p className="auth-alert error" role="alert" data-testid="error-auth">{error}</p>}
                {message && <p className="auth-alert success" role="status" data-testid="status-auth">{message}</p>}
                <button className="button-primary auth-submit" type="submit" disabled={isSubmitting} data-testid="button-auth-submit">
                  {isSubmitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in to Foundit' : 'Create student account'}
                </button>
              </form>
              <p className="auth-footnote"><ShieldCheck size={14} /> Anyone can browse reports. Sign in to post or manage your own.</p>
            </>
          )}
        </section>
      )}
    </div>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={AuthGate} />
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
