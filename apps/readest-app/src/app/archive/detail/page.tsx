'use client';

import clsx from 'clsx';
import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/hooks/useTranslation';

import {
  ARCHIVE_STATUSES,
  ARCHIVE_STATUS_KEYS,
  ArchiveBook,
  ArchiveRound,
  ArchiveStatus,
} from '@/features/archive/types';
import NotesSection from '@/features/archive/components/NotesSection';
import { ArchiveDb } from '@/features/archive/db/archiveDb';

/**
 * Book detail / metadata editor (PRD A1–A4): manual completion of every
 * field, five-state switch, per-round display, tag editing, duplicate hint.
 *
 * Client child uses useSearchParams, which Next 16 requires to be wrapped
 * in Suspense for statically exported routes (see app/s/page.tsx).
 */
const ArchiveDetailPageContent: React.FC = () => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookId = searchParams?.get('id') ?? '';
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const getBookByHash = useLibraryStore((state) => state.getBookByHash);
  const archiveEnabled = useSettingsStore(
    (state) => (state.settings.archive?.enabled ?? true) === true,
  );

  // Module-off contract (PRD 0.4): leaving the feature must return upstream
  // behavior — deep-linked/back-forward visits to this route redirect out.
  useEffect(() => {
    if (!archiveEnabled) router.replace('/library');
  }, [archiveEnabled, router]);

  const [book, setBook] = useState<ArchiveBook | null>(null);
  const [rounds, setRounds] = useState<ArchiveRound[]>([]);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<ArchiveBook[]>([]);
  const [missing, setMissing] = useState(false);

  // Draft form fields — applied on explicit save (PRD A1: 用户确认后保存).
  const [form, setForm] = useState({
    title: '',
    subtitle: '',
    authors: '',
    translators: '',
    publisher: '',
    publishYear: '',
    pageCount: '',
    isbn: '',
    format: 'ebook' as ArchiveBook['format'],
    series: '',
    fictionType: '' as '' | 'fiction' | 'nonfiction',
    description: '',
    sourceUrl: '',
  });
  const [dirty, setDirty] = useState(false);
  const [newTag, setNewTag] = useState('');

  const load = useCallback(async () => {
    if (!appService || !bookId) return;
    try {
      const db = await ArchiveDb.open(appService);
      const loadedBook = await db.getBook(bookId);
      if (!loadedBook) {
        setMissing(true);
        return;
      }
      const [loadedRounds, loadedTagNames, allTagsRows, dupes] = await Promise.all([
        db.listRounds(bookId),
        db.listBookTagNames(bookId),
        db.listTags(),
        db.findPotentialDuplicates(loadedBook.title, loadedBook.authors, loadedBook.id),
      ]);
      setBook(loadedBook);
      setRounds(loadedRounds);
      setTagNames(loadedTagNames);
      setAllTags(allTagsRows.map((t) => t.name));
      setDuplicates(dupes);
      setForm({
        title: loadedBook.title,
        subtitle: loadedBook.subtitle ?? '',
        authors: loadedBook.authors.join(', '),
        translators: loadedBook.translators.join(', '),
        publisher: loadedBook.publisher ?? '',
        publishYear: loadedBook.publishYear != null ? String(loadedBook.publishYear) : '',
        pageCount: loadedBook.pageCount != null ? String(loadedBook.pageCount) : '',
        isbn: loadedBook.isbn ?? '',
        format: loadedBook.format,
        series: loadedBook.series ?? '',
        fictionType: loadedBook.fictionType ?? '',
        description: loadedBook.description ?? '',
        sourceUrl: loadedBook.sourceUrl ?? '',
      });
      setDirty(false);
    } catch (error) {
      console.error('archive: failed to load detail', error);
      setMissing(true);
    }
  }, [appService, bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateForm = (patch: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const parseContributors = (raw: string): string[] =>
    raw
      .split(/[,;、]/)
      .map((part) => part.trim())
      .filter(Boolean);

  const handleSave = async () => {
    if (!appService || !book || !form.title.trim()) return;
    const year = /^\d{1,4}$/.test(form.publishYear) ? Number(form.publishYear) : null;
    const pages = /^\d+$/.test(form.pageCount) ? Number(form.pageCount) : null;
    const db = await ArchiveDb.open(appService);
    await db.updateBookMetadata(book.id, {
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      authors: parseContributors(form.authors),
      translators: parseContributors(form.translators),
      publisher: form.publisher.trim() || null,
      publishYear: year && year > 0 && year < 2200 ? year : null,
      pageCount: pages,
      isbn: form.isbn.trim() || null,
      format: form.format,
      series: form.series.trim() || null,
      fictionType: form.fictionType || null,
      description: form.description.trim() || null,
      sourceUrl: form.sourceUrl.trim() || null,
    });
    await load();
  };

  const handleStatus = async (status: ArchiveStatus) => {
    if (!appService || !book) return;
    const db = await ArchiveDb.open(appService);
    await db.setStatus(book.id, status);
    await load();
  };

  const handleRating = async (rating: number) => {
    if (!appService || !book) return;
    const next = book.rating === rating ? null : rating;
    const db = await ArchiveDb.open(appService);
    await db.updateBookMetadata(book.id, { rating: next });
    await load();
  };

  const replaceTags = async (names: string[]) => {
    if (!appService || !book) return;
    const db = await ArchiveDb.open(appService);
    await db.setBookTags(book.id, names);
    await load();
  };

  const handleDeleteProfile = async () => {
    if (!appService || !book) return;
    if (!window.confirm(_('Delete this archive profile? Reading history stays untouched.'))) return;
    const db = await ArchiveDb.open(appService);
    await db.deleteBook(book.id);
    router.push('/archive');
  };

  const roundSummary = useMemo(() => {
    const totalSeconds = rounds.reduce((sum, round) => sum + round.totalSeconds, 0);
    const finishedCount = rounds.filter((round) => round.status === 'finished').length;
    return { totalSeconds, finishedCount };
  }, [rounds]);

  if (missing) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 bg-base-100'>
        <p className='text-sm text-base-content/60'>{_('This archive entry no longer exists.')}</p>
        <button className='btn btn-sm rounded-full' onClick={() => router.push('/archive')}>
          {_('Back')}
        </button>
      </div>
    );
  }

  if (!book) return null;

  const coverUrl = book.bookHash
    ? (getBookByHash(book.bookHash)?.coverImageUrl ?? undefined)
    : undefined;

  return (
    <div
      className='mx-auto flex h-full w-full max-w-[720px] flex-col overflow-y-auto bg-base-100 text-base-content'
      style={{ paddingTop: safeAreaInsets?.top }}
    >
      <header className='flex items-center gap-2 px-4 pt-4'>
        <button className='btn btn-ghost btn-sm' onClick={() => router.push('/archive')}>
          ←
        </button>
        <h1 className='truncate text-lg font-bold'>{book.title}</h1>
        <button
          className={clsx('btn btn-sm ml-auto rounded-full', dirty && 'btn-primary')}
          disabled={!dirty}
          onClick={handleSave}
        >
          {_('Save')}
        </button>
      </header>

      <section className='flex items-start gap-4 px-4 pt-4'>
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt={book.title}
            className='h-[132px] w-[92px] rounded-lg object-cover shadow-md'
          />
        ) : (
          <div className='h-[132px] w-[92px] rounded-lg bg-base-200 shadow-md' />
        )}
        <div className='min-w-0 flex-1 space-y-2'>
          <div className='flex flex-wrap gap-1.5'>
            {ARCHIVE_STATUSES.map((status) => (
              <button
                key={status}
                className={clsx(
                  'btn btn-xs rounded-full',
                  book.status === status ? 'btn-neutral' : 'btn-ghost border-base-300',
                )}
                onClick={() => handleStatus(status)}
              >
                {_(ARCHIVE_STATUS_KEYS[status])}
              </button>
            ))}
          </div>
          <div className='flex items-center gap-2'>
            <span className='text-xs text-base-content/50'>{_('Rating')}</span>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                className={clsx(
                  'text-lg',
                  star <= (book.rating ?? 0) ? 'text-warning' : 'text-base-content/25',
                )}
                onClick={() => handleRating(star)}
                aria-label={`${_('Rating')} ${star}`}
              >
                ★
              </button>
            ))}
          </div>
          <div className='text-xs text-base-content/50'>
            {_('{{rounds}} round(s) · {{minutes}} min total · {{finished}} finished', {
              rounds: Math.max(book.currentRound, rounds.length),
              minutes: Math.round(roundSummary.totalSeconds / 60),
              finished: roundSummary.finishedCount,
            })}
          </div>
          <div className='flex items-center gap-1.5'>
            <span className='text-xs text-base-content/50'>{_('Fiction type')}</span>
            {(['nonfiction', 'fiction'] as const).map((kind) => (
              <button
                key={kind}
                className={clsx(
                  'btn btn-xs rounded-full',
                  form.fictionType === kind ? 'btn-neutral' : 'btn-ghost border-base-300',
                )}
                onClick={() => updateForm({ fictionType: kind })}
              >
                {kind === 'fiction' ? _('Fiction') : _('Non-fiction')}
              </button>
            ))}
            {form.fictionType !== '' && (
              <button
                className='btn btn-ghost btn-xs'
                onClick={() => updateForm({ fictionType: '' })}
                aria-label={_('Clear')}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </section>

      {duplicates.length > 0 && (
        <div className='mx-4 mt-3 rounded-xl bg-warning/10 px-3 py-2 text-xs'>
          {_('{{count}} entr(y|ies) share the same title and author:', {
            count: duplicates.length,
          })}
          {duplicates.map((dup) => (
            <button
              key={dup.id}
              className='link ms-1'
              onClick={() => router.push(`/archive/detail?id=${dup.id}`)}
            >
              {dup.title}
            </button>
          ))}
          <div className='mt-0.5 opacity-80'>
            {_('Keeping both is fine — delete or merge one via tags anytime.')}
          </div>
        </div>
      )}

      <section className='space-y-2 px-4 pt-4'>
        <h2 className='text-sm font-semibold text-base-content/70'>{_('Tags')}</h2>
        <div className='flex flex-wrap items-center gap-1.5'>
          {tagNames.map((name) => (
            <span key={name} className='badge badge-outline badge-sm gap-1'>
              {name}
              <button
                onClick={() => replaceTags(tagNames.filter((t) => t !== name))}
                aria-label={`${_('Remove')} ${name}`}
              >
                ✕
              </button>
            </span>
          ))}
          <input
            className='input input-xs w-28 bg-base-200'
            list='archive-tag-suggestions'
            placeholder={_('Add tag…')}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTag.trim()) {
                void replaceTags([...tagNames, newTag.trim()]);
                setNewTag('');
              }
            }}
          />
          <datalist id='archive-tag-suggestions'>
            {allTags
              .filter((t) => !tagNames.includes(t))
              .map((t) => (
                <option key={t} value={t} />
              ))}
          </datalist>
        </div>
      </section>

      <section className='space-y-2 px-4 pt-4'>
        <h2 className='text-sm font-semibold text-base-content/70'>{_('Reading rounds')}</h2>
        {rounds.length === 0 ? (
          <p className='text-xs text-base-content/50'>
            {_('Rounds appear here once you start reading.')}
          </p>
        ) : (
          <ul className='space-y-1'>
            {rounds.map((round) => (
              <li key={round.id} className='flex items-center justify-between text-xs'>
                <span>
                  #{round.roundNo} ·{' '}
                  {round.status === 'reading'
                    ? _('In progress')
                    : `${fmtDate(round.startedAt)} – ${fmtDate(round.finishedAt)}`}
                </span>
                <span className='text-base-content/50'>
                  {Math.round(round.totalSeconds / 60)} min
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className='grid grid-cols-2 gap-x-3 gap-y-2 px-4 pb-6 pt-4 max-sm:grid-cols-1'>
        <Field label={_('Title')} value={form.title} onChange={(v) => updateForm({ title: v })} />
        <Field
          label={_('Subtitle')}
          value={form.subtitle}
          onChange={(v) => updateForm({ subtitle: v })}
        />
        <Field
          label={_('Authors')}
          value={form.authors}
          onChange={(v) => updateForm({ authors: v })}
          placeholder={_('Comma separated')}
        />
        <Field
          label={_('Translators')}
          value={form.translators}
          onChange={(v) => updateForm({ translators: v })}
          placeholder={_('Comma separated')}
        />
        <Field
          label={_('Publisher')}
          value={form.publisher}
          onChange={(v) => updateForm({ publisher: v })}
        />
        <Field
          label={_('Publish year')}
          value={form.publishYear}
          onChange={(v) => updateForm({ publishYear: v })}
        />
        <Field
          label={_('Page count')}
          value={form.pageCount}
          onChange={(v) => updateForm({ pageCount: v })}
        />
        <Field label={_('ISBN')} value={form.isbn} onChange={(v) => updateForm({ isbn: v })} />
        <div className='form-control'>
          <label className='label pb-1 pt-0'>
            <span className='label-text text-xs text-base-content/60'>{_('Format')}</span>
          </label>
          <select
            className='select select-sm w-full bg-base-200'
            value={form.format}
            onChange={(e) => updateForm({ format: e.target.value as ArchiveBook['format'] })}
          >
            <option value='paper'>{_('Paper')}</option>
            <option value='ebook'>{_('E-book')}</option>
            <option value='audio'>{_('Audio')}</option>
          </select>
        </div>
        <Field
          label={_('Series')}
          value={form.series}
          onChange={(v) => updateForm({ series: v })}
        />
        <Field
          label={_('Source URL')}
          value={form.sourceUrl}
          onChange={(v) => updateForm({ sourceUrl: v })}
        />
        <div className='col-span-full form-control'>
          <label className='label pb-1 pt-0'>
            <span className='label-text text-xs text-base-content/60'>{_('Description')}</span>
          </label>
          <textarea
            className='textarea textarea-bordered h-24 bg-base-200 text-sm'
            value={form.description}
            onChange={(e) => updateForm({ description: e.target.value })}
          />
        </div>
      </section>

      <NotesSection book={book} />
      <footer className='px-4 pb-8'>
        <button className='btn btn-ghost btn-sm text-error' onClick={handleDeleteProfile}>
          {_('Delete profile')}
        </button>
      </footer>
    </div>
  );
};

function fmtDate(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ArchiveDetailPage() {
  return (
    <Suspense fallback={null}>
      <ArchiveDetailPageContent />
    </Suspense>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, placeholder }) => (
  <div className='form-control'>
    <label className='label pb-1 pt-0'>
      <span className='label-text text-xs text-base-content/60'>{label}</span>
    </label>
    <input
      type='text'
      className='input input-sm w-full bg-base-200'
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);
