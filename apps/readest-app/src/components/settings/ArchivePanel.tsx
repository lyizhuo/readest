'use client';

import React, { useEffect, useRef, useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveSysSettings } from '@/helpers/settings';
import { DEFAULT_EXPORT_TEMPLATE_MD } from '@/features/archive/export/template';
import { ArchiveDb } from '@/features/archive/db/archiveDb';
import { SectionTitle, SettingsSwitchRow } from './primitives';

/**
 * Settings > Archive (PRD 0.4 module gate): turning the whole feature off
 * hides every archive surface and restores exact upstream behavior.
 */
const ArchivePanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings } = useSettingsStore();
  const archive = settings.archive ?? { enabled: true, dailyGoalMinutes: 60 };

  const [enabled, setEnabled] = useState(archive.enabled);
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(archive.dailyGoalMinutes);
  // Export template (PRD E3) — stored in archive.db kv, editable here.
  const [templateMd, setTemplateMd] = useState<string | null>(null);

  useEffect(() => {
    if (!appService) return;
    void (async () => {
      try {
        const db = await ArchiveDb.open(appService);
        setTemplateMd((await db.getKv('export_template_md')) ?? DEFAULT_EXPORT_TEMPLATE_MD);
      } catch {
        setTemplateMd(DEFAULT_EXPORT_TEMPLATE_MD);
      }
    })();
  }, [appService]);

  // Debounce: a keystroke updates local state instantly, but the db write
  // fires once typing pauses (OPFS write amplification otherwise).
  const templateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveTemplate = (value: string) => {
    setTemplateMd(value);
    if (!appService) return;
    clearTimeout(templateTimer.current);
    templateTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const db = await ArchiveDb.open(appService);
          await db.setKv('export_template_md', value);
        } catch (error) {
          console.warn('archive: failed to save template', error);
        }
      })();
    }, 600);
  };

  const toggleEnabled = () => {
    const next = !enabled;
    setEnabled(next);
    void saveSysSettings(envConfig, 'archive', { ...archive, enabled: next });
    setSettings({ ...settings, archive: { ...archive, enabled: next } });
  };

  const changeGoal = (delta: number) => {
    const next = Math.min(1440, Math.max(0, dailyGoalMinutes + delta));
    if (next === dailyGoalMinutes) return;
    setDailyGoalMinutes(next);
    void saveSysSettings(envConfig, 'archive', { ...archive, dailyGoalMinutes: next });
    setSettings({ ...settings, archive: { ...archive, dailyGoalMinutes: next } });
  };

  return (
    <div className='p-2'>
      <SectionTitle>{_('Reading Archive')}</SectionTitle>
      <div className='my-2 rounded-box border border-base-200 bg-base-100'>
        <SettingsSwitchRow
          label={_('Enable Reading Archive')}
          description={_('Book profiles, reading rounds and stats. Off = plain Readest.')}
          checked={enabled}
          onChange={toggleEnabled}
        />
      </div>

      <div className='my-2 flex items-center justify-between rounded-box border border-base-200 bg-base-100 px-4 py-3'>
        <div>
          <p className='text-sm'>{_('Daily goal')}</p>
          <p className='text-xs text-base-content/50'>
            {_('Minutes of reading per day across all books')}
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <button
            className='btn btn-circle btn-sm'
            onClick={() => changeGoal(-5)}
            aria-label={_('Decrease')}
          >
            −
          </button>
          <span className='w-16 text-center text-lg font-semibold tabular-nums'>
            {dailyGoalMinutes}
          </span>
          <button
            className='btn btn-circle btn-sm'
            onClick={() => changeGoal(5)}
            aria-label={_('Increase')}
          >
            +
          </button>
        </div>
      </div>

      <div className='my-2 rounded-box border border-base-200 bg-base-100 p-3'>
        <p className='mb-1 text-sm'>{_('Markdown export template')}</p>
        <p className='mb-2 text-xs text-base-content/50'>
          {_('Tokens: {{chapter}} {{text}} {{note}} {{page}} {{progress}} {{tags}} ^{{noteId}}')}
        </p>
        <textarea
          className='textarea textarea-bordered h-32 w-full bg-base-200 font-mono text-xs'
          value={templateMd ?? ''}
          onChange={(e) => void saveTemplate(e.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  );
};

export default ArchivePanel;
