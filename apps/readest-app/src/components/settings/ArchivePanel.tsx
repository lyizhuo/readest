'use client';

import React, { useState } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveSysSettings } from '@/helpers/settings';
import { SectionTitle, SettingsSwitchRow } from './primitives';

/**
 * Settings > Archive (PRD 0.4 module gate): turning the whole feature off
 * hides every archive surface and restores exact upstream behavior.
 */
const ArchivePanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings } = useSettingsStore();
  const archive = settings.archive ?? { enabled: true, dailyGoalMinutes: 60 };

  const [enabled, setEnabled] = useState(archive.enabled);
  const [dailyGoalMinutes, setDailyGoalMinutes] = useState(archive.dailyGoalMinutes);

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
    </div>
  );
};

export default ArchivePanel;
