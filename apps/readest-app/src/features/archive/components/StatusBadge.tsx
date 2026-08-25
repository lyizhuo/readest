'use client';

import React from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { ARCHIVE_STATUS_KEYS, ArchiveStatus } from '../types';

const StatusBadge: React.FC<{ status: ArchiveStatus }> = ({ status }) => {
  const _ = useTranslation();
  return (
    <span className='badge badge-ghost badge-sm text-[11px]'>{_(ARCHIVE_STATUS_KEYS[status])}</span>
  );
};

export default StatusBadge;
