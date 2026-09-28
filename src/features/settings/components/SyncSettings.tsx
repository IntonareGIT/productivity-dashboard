import React from 'react';
import { UNSYNCED_TABLES } from '../../../db/cloudConfig';
import { SyncAccountPanel } from './SyncAccountPanel';

/**
 * Settings → Sync.
 *
 * Thin wrapper over the shared `SyncAccountPanel`, so the top-bar profile menu
 * and this page read exactly the same account state (one `useCloudAccount()`
 * subscription, no duplicated logic or sign-out rules). Diagnostics stay here.
 */
export const SyncSettings: React.FC = () => (
  <SyncAccountPanel variant="card" showDiagnostics>
    <p className="text-[11px] text-content-tertiary">
      Never synced (kept per-device): {UNSYNCED_TABLES.join(', ')}.
    </p>
  </SyncAccountPanel>
);
