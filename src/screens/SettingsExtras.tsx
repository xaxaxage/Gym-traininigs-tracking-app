import { AppearanceSettings } from './AppearanceSettings';
import { SyncSettings } from './SyncSettings';

/** Appearance, sync and Claude settings. */
export function SettingsExtras() {
  return (
    <>
      <AppearanceSettings />
      <SyncSettings />
    </>
  );
}
