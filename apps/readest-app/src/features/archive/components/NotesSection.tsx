'use client';

import clsx from 'clsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';

import { ArchiveBook } from '../types';
import { ArchiveNote, ArchiveDb } from '../db/archiveDb';
import { loadExcerpts } from '../notes/excerptAccess';
import type { ExcerptWithChapter } from '../notes/excerptAccess';

/**
 * Per-book notes view (PRD D): upstream excerpts grouped by chapter +
 * archive-native thoughts with chapter suggestion (TOC ∪ history) and
 * image attachments (PRD D3).
 */
const NotesSection: React.FC<{ book: ArchiveBook }> = ({ book }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const settings = useSettingsStore((state) => state.settings);

  const [tab, setTab] = useState<'excerpts' | 'thoughts'>('excerpts');
  const [excerpts, setExcerpts] = useState<ExcerptWithChapter[] | null>(null);
  const [thoughts, setThoughts] = useState<ArchiveNote[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const reloadThoughts = useCallback(async () => {
    if (!appService) return;
    const db = await ArchiveDb.open(appService);
    setThoughts(await db.listThoughts(book.id));
    setSuggestions(await db.listUsedChapters(book.id));
  }, [appService, book.id]);

  useEffect(() => {
    if (!appService) return;
    void (async () => {
      setExcerpts(
        await loadExcerpts(appService, settings, {
          hash: book.bookHash ?? '',
          title: book.title,
        }).catch(() => []),
      );
    })();
    void reloadThoughts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService, book.id]);

  return (
    <section className='space-y-3 px-4 pt-4'>
      <div className='flex gap-1.5'>
        <button
          className={clsx(
            'btn btn-xs rounded-full',
            tab === 'excerpts' ? 'btn-neutral' : 'btn-ghost border-base-300',
          )}
          onClick={() => setTab('excerpts')}
        >
          {_('Excerpts')} ({excerpts?.length ?? '…'})
        </button>
        <button
          className={clsx(
            'btn btn-xs rounded-full',
            tab === 'thoughts' ? 'btn-neutral' : 'btn-ghost border-base-300',
          )}
          onClick={() => setTab('thoughts')}
        >
          {_('Thoughts')} ({thoughts.length})
        </button>
      </div>

      {tab === 'excerpts' && <ExcerptList excerpts={excerpts} />}
      {tab === 'thoughts' && (
        <ThoughtEditor
          book={book}
          thoughts={thoughts}
          suggestions={suggestions}
          onSaved={() => void reloadThoughts()}
        />
      )}
    </section>
  );
};

/** Renders excerpts grouped by their TOC path (PRD D4 书详情页按章节分组). */
const ExcerptList: React.FC<{ excerpts: ExcerptWithChapter[] | null }> = ({ excerpts }) => {
  const _ = useTranslation();
  if (excerpts === null) {
    return <p className='text-xs text-base-content/40'>{_('Loading…')}</p>;
  }
  if (excerpts.length === 0) {
    return (
      <p className='text-xs text-base-content/50'>
        {_('No highlights yet — select text while reading to create one.')}
      </p>
    );
  }
  const byChapter: Record<string, ExcerptWithChapter[]> = {};
  for (const excerpt of excerpts) {
    const key = excerpt.chapterPath ?? _('(unknown location)');
    (byChapter[key] ??= []).push(excerpt);
  }
  return (
    <ul className='space-y-3'>
      {Object.entries(byChapter).map(([chapter, items]) => (
        <li key={chapter}>
          <p className='text-[11px] font-semibold uppercase tracking-wide text-base-content/40'>
            {chapter}
          </p>
          <ul className='mt-1 space-y-2'>
            {items.map((item) => (
              <li key={item.id} className='rounded-xl bg-base-200/60 px-3 py-2 text-sm'>
                {item.text && (
                  <blockquote className='border-s-2 border-base-content/20 ps-2'>
                    {item.text}
                  </blockquote>
                )}
                {item.note && <p className='mt-1 text-base-content/70'>✏️ {item.note}</p>}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
};

interface ThoughtDraft {
  id?: string;
  content: string;
  chapterTitle: string;
  attachments: string[];
}

/** Downscales an picked image to a compact JPEG data URL (PRD D3 配图). */
function pickImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('image decode failed'));
      img.onload = () => {
        const maxEdge = 1600;
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const ThoughtEditor: React.FC<{
  book: ArchiveBook;
  thoughts: ArchiveNote[];
  suggestions: string[];
  onSaved: () => void;
}> = ({ book, thoughts, suggestions, onSaved }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [draft, setDraft] = useState<ThoughtDraft>({
    content: '',
    chapterTitle: '',
    attachments: [],
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const save = async () => {
    if (!appService || !draft.content.trim()) return;
    const db = await ArchiveDb.open(appService);
    if (draft.id) {
      await db.updateThought(draft.id, {
        content: draft.content.trim(),
        chapterTitle: draft.chapterTitle.trim() || null,
        attachments: draft.attachments,
      });
    } else {
      await db.createThought({
        bookId: book.id,
        roundNo: book.currentRound,
        chapterTitle: draft.chapterTitle.trim() || null,
        content: draft.content.trim(),
        attachments: draft.attachments,
      });
    }
    setDraft({ content: '', chapterTitle: '', attachments: [] });
    onSaved();
  };

  const handlePickImage = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const dataUrl = await pickImageAsDataUrl(files[0]!);
      setDraft((prev) => ({ ...prev, attachments: [...prev.attachments, dataUrl] }));
    } catch (error) {
      console.warn('archive: image pick failed', error);
    }
  };

  return (
    <div className='space-y-2'>
      <datalist id='archive-thought-chapters'>
        {[...new Set(suggestions)].map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>
      <input
        className='input input-sm w-full bg-base-200'
        list='archive-thought-chapters'
        placeholder={_('Chapter (optional)')}
        value={draft.chapterTitle}
        onChange={(e) => setDraft((prev) => ({ ...prev, chapterTitle: e.target.value }))}
      />
      <textarea
        className='textarea textarea-bordered w-full bg-base-200 text-sm'
        rows={3}
        placeholder={_('Write a thought…')}
        value={draft.content}
        onChange={(e) => setDraft((prev) => ({ ...prev, content: e.target.value }))}
      />
      {draft.attachments.length > 0 && (
        <div className='flex flex-wrap gap-1'>
          {draft.attachments.map((dataUrl, idx) => (
            <span key={idx} className='relative'>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dataUrl} alt='' className='max-h-24 rounded-lg object-cover' />
              <button
                className='absolute -end-1 -top-1 h-4 w-4 rounded-full bg-error text-[10px] leading-4 text-error-content'
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    attachments: prev.attachments.filter((_, i) => i !== idx),
                  }))
                }
                aria-label={_('Remove')}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <div className='flex items-center justify-end gap-1.5'>
        <input
          ref={fileInputRef}
          type='file'
          accept='image/*'
          className='hidden'
          onChange={(e) => void handlePickImage(e.target.files)}
        />
        <button className='btn btn-ghost btn-sm' onClick={() => fileInputRef.current?.click()}>
          🖼 {_('Attach image')}
        </button>
        {draft.id && (
          <button
            className='btn btn-ghost btn-sm'
            onClick={() => setDraft({ content: '', chapterTitle: '', attachments: [] })}
          >
            {_('Cancel')}
          </button>
        )}
        <button
          className={clsx('btn btn-sm rounded-full', draft.content.trim() && 'btn-primary')}
          disabled={!draft.content.trim()}
          onClick={save}
        >
          {draft.id ? _('Update') : _('Add thought')}
        </button>
      </div>

      <ul className='space-y-2'>
        {thoughts.map((thought) => (
          <li key={thought.id} className='rounded-xl bg-base-200/60 px-3 py-2 text-sm'>
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0 flex-1'>
                {thought.chapterTitle && (
                  <p className='text-[11px] text-base-content/40'>{thought.chapterTitle}</p>
                )}
                <p className='whitespace-pre-wrap'>{thought.content}</p>
                {thought.attachments.length > 0 && (
                  <div className='mt-1 flex flex-wrap gap-1'>
                    {thought.attachments.map((dataUrl, idx) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={idx}
                        src={dataUrl}
                        alt=''
                        className='max-h-28 rounded-lg object-cover'
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className='flex flex-none flex-col gap-1'>
                <button
                  className='btn btn-ghost btn-xs'
                  onClick={() =>
                    setDraft({
                      id: thought.id,
                      content: thought.content,
                      chapterTitle: thought.chapterTitle ?? '',
                      attachments: thought.attachments,
                    })
                  }
                >
                  {_('Edit')}
                </button>
                <button
                  className='btn btn-ghost btn-xs text-error'
                  onClick={async () => {
                    if (!appService) return;
                    const db = await ArchiveDb.open(appService);
                    await db.deleteThought(thought.id);
                    onSaved();
                  }}
                >
                  {_('Delete')}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default NotesSection;
