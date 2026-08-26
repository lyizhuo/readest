'use client';

import clsx from 'clsx';
import React from 'react';
import { useRouter } from 'next/navigation';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { navigateToReader } from '@/utils/nav';

import type { DailyReviewCandidate } from './select';

/** Formats a note timestamp as a local YYYY-MM-DD date for the card meta line. */
const formatDate = (ms: number): string => {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
};

/**
 * Daily note review modal (fork feature, PRD F): a handful of old notes
 * resurfaced once per local day on the library page. Clicking a card jumps
 * into that book's reader; 关闭 dismisses until the next day.
 */
const DailyReviewModal: React.FC<{
  notes: DailyReviewCandidate[];
  onClose: () => void;
}> = ({ notes, onClose }) => {
  const _ = useTranslation();
  const router = useRouter();
  const settings = useSettingsStore((state) => state.settings);

  const handleOpen = (note: DailyReviewCandidate) => {
    if (!note.bookHash || settings.archive?.enabled === false) return;
    const cfi = note.cfi ? `cfi=${encodeURIComponent(note.cfi)}` : undefined;
    navigateToReader(router, [note.bookHash], cfi);
    onClose();
  };

  return (
    <dialog className='modal modal-open' open>
      <div className='modal-box max-w-lg rounded-2xl'>
        <h3 className='pb-2 text-lg font-bold'>{_('Daily Review')}</h3>
        {notes.length === 0 ? (
          <p className='py-4 text-center text-sm text-base-content/50'>
            {_('No notes to review yet')}
          </p>
        ) : (
          <ul className='space-y-2'>
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  className={clsx(
                    'w-full rounded-xl border border-base-300 bg-base-200 p-3 text-left',
                    'transition-colors hover:bg-base-300',
                  )}
                  onClick={() => handleOpen(note)}
                >
                  <div className='mb-1 flex items-center justify-between gap-2 text-xs text-base-content/60'>
                    <span className='truncate font-medium'>{note.bookTitle}</span>
                    <span className='shrink-0'>{formatDate(note.createdAt)}</span>
                  </div>
                  {note.chapterTitle && (
                    <div className='mb-1 truncate text-xs text-base-content/50'>
                      {note.chapterTitle}
                    </div>
                  )}
                  <p className='line-clamp-3 text-sm'>{note.content}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className='mt-4 flex justify-end'>
          <button className='btn btn-sm btn-ghost' onClick={onClose}>
            {_('Close')}
          </button>
        </div>
      </div>
      <form method='dialog' className='modal-backdrop'>
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
};

export default DailyReviewModal;
