'use client';

import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useTranslation } from '@/hooks/useTranslation';
import { navigateToLibrary } from '@/utils/nav';

import { ARCHIVE_STATUSES, ARCHIVE_STATUS_KEYS, ArchiveStatus } from '@/features/archive/types';
import { ArchiveDb } from '@/features/archive/db/archiveDb';
import StatusBadge from '@/features/archive/components/StatusBadge';
import { buildLibraryCsv, CsvExportRow } from '@/features/archive/library/csvExport';
import { useArchiveLibrary } from '@/features/archive/hooks/useArchiveLibrary';
import ReadingHome from '@/features/archive/components/ReadingHome';

const STATUS_ORDER: (ArchiveStatus | 'all')[] = ['all', ...ARCHIVE_STATUSES];

/**
 * Reading-archive bookshelf (PRD §3.5.2): list layout with cover thumbnails,
 * five-state filter chips, tag management, and library CSV export.
 */
const ArchivePage: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { safeAreaInsets } = useThemeStore();
  const { appService } = useEnv();
  const { enabled, loaded, books, tags, refresh, getCoverUrl } = useArchiveLibrary();

  const [statusFilter, setStatusFilter] = useState<ArchiveStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) router.replace('/library');
  }, [enabled, router]);

  const counts = useMemo(() => {
    const byStatus: Record<string, number> = { all: books.length };
    for (const status of ARCHIVE_STATUSES) byStatus[status] = 0;
    for (const book of books) byStatus[book.status] = (byStatus[book.status] ?? 0) + 1;
    return byStatus;
  }, [books]);

  const filteredBooks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return books.filter((book) => {
      if (statusFilter !== 'all' && book.status !== statusFilter) return false;
      if (!q) return true;
      return (
        book.title.toLowerCase().includes(q) ||
        book.authors.some((a) => a.toLowerCase().includes(q)) ||
        book.series?.toLowerCase().includes(q)
      );
    });
  }, [books, statusFilter, query]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2000);
  };

  const handleExportCsv = async () => {
    if (!appService || books.length === 0) return;
    const db = await ArchiveDb.open(appService);
    const rows: CsvExportRow[] = [];
    for (const book of books) {
      const [tagNames, rounds] = await Promise.all([
        db.listBookTagNames(book.id),
        db.listRounds(book.id),
      ]);
      rows.push({
        book,
        tags: tagNames,
        totalReadingMinutes: rounds.reduce((sum, round) => sum + round.totalSeconds, 0) / 60,
        finishedRounds: rounds.filter((round) => round.status === 'finished').length,
      });
    }
    const csv = buildLibraryCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `readest-library-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!enabled) return null;

  return (
    <div
      className='mx-auto flex h-full w-full max-w-[720px] flex-col bg-base-100 text-base-content'
      style={{ paddingTop: safeAreaInsets?.top }}
    >
      <header className='flex items-center justify-between px-4 pt-4'>
        <div className='flex items-center gap-2'>
          <button
            className='btn btn-ghost btn-sm'
            onClick={() => navigateToLibrary(router)}
            aria-label={_('Back to Library')}
          >
            ←
          </button>
          <h1 className='text-lg font-bold'>{_('Reading Archive')}</h1>
          <span className='text-xs text-base-content/50'>
            {_('{{count}} books', { count: books.length })}
          </span>
        </div>
        <div className='flex items-center gap-1'>
          <button className='btn btn-ghost btn-sm' onClick={() => setTagManagerOpen(true)}>
            {_('Tags')}
          </button>
          <button className='btn btn-ghost btn-sm' onClick={() => router.push('/archive/calendar')}>
            {_('Calendar')}
          </button>
          <button
            className='btn btn-ghost btn-sm'
            disabled={books.length === 0}
            onClick={handleExportCsv}
          >
            {_('Export CSV')}
          </button>
        </div>
      </header>

      <ReadingHome books={books} getCoverUrl={getCoverUrl} />

      <div className='px-4 pt-3'>
        <input
          type='text'
          className='input input-sm w-full rounded-full bg-base-200'
          placeholder={_('Search title, author, series…')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className='flex flex-wrap gap-1.5 px-4 py-3'>
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            className={clsx(
              'btn btn-xs rounded-full',
              statusFilter === status ? 'btn-neutral' : 'btn-ghost border-base-300',
            )}
            onClick={() => setStatusFilter(status)}
          >
            {status === 'all' ? _('All') : _(ARCHIVE_STATUS_KEYS[status])}
            <span className='opacity-60'>&nbsp;{counts[status] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className='flex-1 overflow-y-auto px-4 pb-8'>
        {!loaded ? (
          <div className='pt-16 text-center text-sm text-base-content/50'>{_('Loading…')}</div>
        ) : filteredBooks.length === 0 ? (
          <div className='pt-16 text-center text-sm text-base-content/50'>
            {_('No books here yet. Import books in the library first.')}
          </div>
        ) : (
          <ul className='divide-base-200/60 divide-y'>
            {filteredBooks.map((book) => (
              <li key={book.id}>
                <button
                  className='flex w-full items-center gap-3 py-2.5 text-start'
                  onClick={() => router.push(`/archive/detail?id=${book.id}`)}
                >
                  <BookCoverThumb url={getCoverUrl(book.bookHash)} title={book.title} />
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate font-semibold'>{book.title}</span>
                    <span className='block truncate text-xs text-base-content/50'>
                      {book.authors.join(', ') || _('Unknown author')}
                    </span>
                    <span className='mt-0.5 flex items-center gap-1.5'>
                      <StatusBadge status={book.status} />
                      {book.currentRound > 1 && (
                        <span className='text-[11px] text-base-content/40'>
                          #{book.currentRound}
                        </span>
                      )}
                      {book.rating != null && (
                        <span className='text-[11px] text-warning'>{'★'.repeat(book.rating)}</span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {tagManagerOpen && (
        <TagManagerModal
          tags={tags}
          onClose={() => setTagManagerOpen(false)}
          onChanged={() => {
            void refresh();
            showToast(_('Tags updated'));
          }}
        />
      )}

      {toast && (
        <div className='toast toast-bottom toast-center z-50'>
          <div className='alert alert-sm text-sm'>{toast}</div>
        </div>
      )}
    </div>
  );
};

const BookCoverThumb: React.FC<{ url?: string; title: string }> = ({ url, title }) =>
  url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={title}
      className='h-[56px] w-[40px] flex-shrink-0 rounded-md object-cover shadow-sm'
    />
  ) : (
    <div className='flex h-[56px] w-[40px] flex-shrink-0 items-center justify-center rounded-md bg-base-200 p-1 text-center text-[9px] leading-tight text-base-content/40'>
      {title.slice(0, 12)}
    </div>
  );

interface TagManagerModalProps {
  tags: { id: string; name: string; color: string | null }[];
  onClose: () => void;
  onChanged: () => void;
}

/** Tag hygiene per PRD A3: rename, merge duplicates, delete. */
const TagManagerModal: React.FC<TagManagerModalProps> = ({ tags, onClose, onChanged }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [mergeTargets, setMergeTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const mutate = async (fn: (db: ArchiveDb) => Promise<void>) => {
    if (!appService || busy) return;
    setBusy(true);
    setError(null);
    try {
      const db = await ArchiveDb.open(appService);
      await fn(db);
      onChanged();
    } catch (err) {
      // e.g. renameTag rejecting a case-insensitive duplicate name.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog className='modal modal-open' open>
      <div className='modal-box max-w-md rounded-2xl'>
        <h3 className='pb-2 text-lg font-bold'>{_('Manage Tags')}</h3>
        {tags.length === 0 ? (
          <p className='py-6 text-center text-sm text-base-content/50'>{_('No tags yet')}</p>
        ) : (
          <ul className='divide-base-200/60 divide-y'>
            {tags.map((tag) => (
              <li key={tag.id} className='flex items-center gap-2 py-2'>
                <input
                  className='input input-sm w-32 bg-base-200'
                  value={renames[tag.id] ?? tag.name}
                  onChange={(e) => setRenames((prev) => ({ ...prev, [tag.id]: e.target.value }))}
                />
                <select
                  className='select select-sm w-36 bg-base-200'
                  value={mergeTargets[tag.id] ?? ''}
                  onChange={(e) =>
                    setMergeTargets((prev) => ({ ...prev, [tag.id]: e.target.value }))
                  }
                >
                  <option value=''>{_('Merge into…')}</option>
                  {tags
                    .filter((other) => other.id !== tag.id)
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name}
                      </option>
                    ))}
                </select>
                <div className='ml-auto flex items-center gap-1'>
                  <button
                    className='btn btn-ghost btn-xs'
                    disabled={
                      busy ||
                      !(renames[tag.id] ?? tag.name).trim() ||
                      (renames[tag.id] ?? tag.name).trim() === tag.name ||
                      tags.some(
                        (other) =>
                          other.id !== tag.id &&
                          other.name.toLowerCase() ===
                            (renames[tag.id] ?? tag.name).trim().toLowerCase(),
                      )
                    }
                    onClick={() =>
                      mutate(async (db) => {
                        await db.renameTag(tag.id, renames[tag.id]!.trim());
                      })
                    }
                  >
                    {_('Rename')}
                  </button>
                  <button
                    className='btn btn-ghost btn-xs'
                    disabled={busy || !mergeTargets[tag.id]}
                    onClick={() => {
                      const intoId = mergeTargets[tag.id]!;
                      void mutate(async (db) => {
                        await db.mergeTags(tag.id, intoId);
                      });
                    }}
                  >
                    {_('Merge')}
                  </button>
                  <button
                    className='btn btn-ghost btn-xs text-error'
                    disabled={busy}
                    onClick={() =>
                      mutate(async (db) => {
                        await db.deleteTag(tag.id);
                      })
                    }
                  >
                    {_('Delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && <p className='mt-2 text-center text-xs text-error'>{error}</p>}
        <div className='modal-action'>
          <button className='btn btn-sm rounded-full' onClick={onClose}>
            {_('Done')}
          </button>
        </div>
      </div>
      <button className='modal-backdrop' onClick={onClose} aria-label={_('Close')} />
    </dialog>
  );
};

export default ArchivePage;
