'use client';

import clsx from 'clsx';
import React, { useEffect, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';

import { ArchiveBook } from '../types';
import { ArchiveDb } from '../db/archiveDb';
import { buildLibraryCsv } from '../library/csvExport';
import {
  downloadContent,
  exportBook,
  importArchiveJson,
  type ExportFormat,
} from '../export/exportService';

/**
 * Notes export dialog (PRD E3/E4): book × round-range × format, plus JSON
 * round-trip import. No quantity limits — the data always leaves complete.
 */
const ExportDialog: React.FC<{ books: ArchiveBook[]; onClose: () => void }> = ({
  books,
  onClose,
}) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const settings = useSettingsStore((state) => state.settings);
  const [bookId, setBookId] = useState(books[0]?.id ?? '');
  const [roundFilter, setRoundFilter] = useState<'current' | 'all'>('all');
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Load the saved markdown template (falls back to the built-in default).
  const [templateMd, setTemplateMd] = useState('');
  useEffect(() => {
    if (!appService) return;
    void (async () => {
      try {
        const db = await ArchiveDb.open(appService);
        setTemplateMd(
          (await db.getKv('export_template_md')) ??
            (await import('../export/template')).DEFAULT_EXPORT_TEMPLATE_MD,
        );
      } catch {
        setTemplateMd('');
      }
    })();
  }, [appService]);

  const handleExport = async () => {
    if (!appService || !bookId || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportBook(
        appService,
        settings,
        bookId,
        roundFilter,
        format,
        templateMd,
      );
      if (!result) {
        setMessage(_('Book not found'));
        return;
      }
      downloadContent(result.filename, result.content);
      setMessage(_('Exported ✓'));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleExportCsv = async () => {
    if (!appService || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const db = await ArchiveDb.open(appService);
      const rows = [];
      for (const b of books) {
        const [tagNames, rounds] = await Promise.all([
          db.listBookTagNames(b.id),
          db.listRounds(b.id),
        ]);
        rows.push({
          book: b,
          tags: tagNames,
          totalReadingMinutes: rounds.reduce((sum, r) => sum + r.totalSeconds, 0) / 60,
          finishedRounds: rounds.filter((r) => r.status === 'finished').length,
        });
      }
      downloadContent(
        `readest-library-${new Date().toISOString().slice(0, 10)}.csv`,
        buildLibraryCsv(rows),
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const handleImportJson = async (file: File | undefined) => {
    if (!appService || !file) return;
    setBusy(true);
    setMessage(null);
    try {
      const raw = await file.text();
      const count = await importArchiveJson(appService, raw);
      setMessage(_('Imported {{count}} thoughts', { count }));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog className='modal modal-open' open>
      <div className='modal-box max-w-md rounded-2xl'>
        <h3 className='pb-2 text-lg font-bold'>{_('Export notes')}</h3>

        {books.length === 0 ? (
          <p className='py-4 text-center text-sm text-base-content/50'>{_('No books yet')}</p>
        ) : (
          <div className='space-y-3'>
            <select
              className='select select-sm w-full bg-base-200'
              value={bookId}
              onChange={(e) => setBookId(e.target.value)}
            >
              {books.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title}
                </option>
              ))}
            </select>

            <div className='flex gap-1.5'>
              {(
                [
                  ['all', _('All rounds')],
                  ['current', _('Current round')],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={clsx(
                    'btn btn-xs rounded-full',
                    roundFilter === value ? 'btn-neutral' : 'btn-ghost border-base-300',
                  )}
                  onClick={() => setRoundFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className='flex gap-1.5'>
              {(
                [
                  ['markdown', 'Markdown'],
                  ['json', 'JSON'],
                  ['txt', 'TXT'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className={clsx(
                    'btn btn-xs rounded-full',
                    format === value ? 'btn-neutral' : 'btn-ghost border-base-300',
                  )}
                  onClick={() => setFormat(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className='text-xs text-base-content/50'>
              {_('Your data exports in full — no limits, ever.')}
            </p>
          </div>
        )}

        {message && <p className='mt-2 text-center text-xs text-base-content/60'>{message}</p>}

        <div className='modal-action'>
          <label className='btn btn-ghost btn-sm cursor-pointer'>
            {_('Import JSON')}
            <input
              type='file'
              accept='.json,application/json'
              className='hidden'
              onChange={(e) => {
                void handleImportJson(e.target.files?.[0]);
                e.target.value = ''; // allow re-picking the same file
              }}
            />
          </label>
          <button className='btn btn-ghost btn-sm' disabled={busy} onClick={handleExportCsv}>
            {_('Library CSV')}
          </button>
          <button
            className='btn btn-sm btn-primary rounded-full'
            disabled={busy || !bookId}
            onClick={handleExport}
          >
            {_('Export')}
          </button>
          <button className='btn btn-ghost btn-sm' onClick={onClose}>
            {_('Close')}
          </button>
        </div>
      </div>
      <button className='modal-backdrop' onClick={onClose} aria-label={_('Close')} />
    </dialog>
  );
};

export default ExportDialog;
