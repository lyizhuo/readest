'use client';

import clsx from 'clsx';
import React, { useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';

import { ArchiveBook } from '../types';
import { ArchiveDb } from '../db/archiveDb';
import type { ExcerptWithChapter } from '../notes/excerptAccess';
import { askAI, AI_DISABLED_HINT, AI_ERROR_HINT, isAIEnabled } from './client';
import { askAboutExcerpt } from './prompts';

/**
 * Ask-AI popover for one excerpt (PRD I 标注 AI 生成): optional question →
 * model answer → saveable as an archive thought tagged ['AI'] and parented
 * to the excerpt. Never throws into the page — failures render inline.
 */
const ExcerptAsk: React.FC<{
  book: ArchiveBook;
  excerpt: ExcerptWithChapter;
  onSaved?: () => void;
}> = ({ book, excerpt, onSaved }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const settings = useSettingsStore((state) => state.settings);

  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const run = async () => {
    if (!isAIEnabled(settings)) {
      setError(_(AI_DISABLED_HINT));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setAnswer(await askAI(settings, askAboutExcerpt(excerpt, question.trim() || undefined)));
    } catch (err) {
      console.warn('archive: excerpt ask failed', err);
      setError(_(AI_ERROR_HINT));
    } finally {
      setBusy(false);
    }
  };

  const saveAsThought = async () => {
    if (!appService || !answer) return;
    try {
      const db = await ArchiveDb.open(appService);
      await db.createThought({
        bookId: book.id,
        roundNo: book.currentRound,
        parentNoteId: excerpt.id,
        cfi: excerpt.cfi,
        chapterTitle: excerpt.chapterPath,
        content: answer,
        tags: ['AI'],
      });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      console.warn('archive: failed to save AI thought', err);
      setError(_(AI_ERROR_HINT));
    }
  };

  return (
    <div className='mt-1'>
      <button
        className='btn btn-ghost btn-xs text-base-content/50'
        onClick={() => setOpen((prev) => !prev)}
      >
        ✨ {_('Ask AI')}
      </button>
      {open && (
        <div className='mt-1 space-y-1.5 rounded-lg bg-base-100 p-2'>
          <div className='flex gap-1.5'>
            <input
              className='input input-xs grow bg-base-200'
              placeholder={_('Ask a question (optional)…')}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !busy) void run();
              }}
            />
            <button
              className={clsx('btn btn-xs rounded-full', !busy && 'btn-primary')}
              disabled={busy}
              onClick={() => void run()}
            >
              {busy ? _('Thinking…') : _('Go')}
            </button>
          </div>
          {error && <p className='text-xs text-error'>{error}</p>}
          {answer && (
            <>
              <p className='whitespace-pre-wrap text-sm'>{answer}</p>
              <button
                className={clsx('btn btn-xs rounded-full', saved && 'btn-success')}
                disabled={saved}
                onClick={() => void saveAsThought()}
              >
                {saved ? _('Saved') : _('Save as thought')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ExcerptAsk;
