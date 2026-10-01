import { AppearanceSettings } from './AppearanceSettings';
import { ClaudeSettings } from './ClaudeSettings';
import { SyncSettings } from './SyncSettings';

/** Appearance, sync and Claude settings. */
export function SettingsExtras() {
  return (
    <>
      <AppearanceSettings />
      <SyncSettings />
      <ClaudeSettings />
    </>
  );
}
