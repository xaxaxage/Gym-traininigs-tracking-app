import { updateSettings, useData } from '../lib/store';
import { AUTO_THEME, HARBOR, PALETTES, type ThemeBase } from '../lib/theme';
import { systemReducesMotion } from '../lib/motion';
import { Switch } from '../components/Common';
import { Check } from '../components/Icons';

/** A tiny picture of the app in a palette: page, a card with a line of text, the main, accent and warning colors. */
export function Swatch({ base }: { base: ThemeBase }) {
  return (
    <span class="swatch" style={{ background: base.bg }} aria-hidden="true">
      <span class="swatch-card" style={{ background: base.surface }}>
        <span class="swatch-text" style={{ background: base.ink }} />
        <span class="swatch-dots">
          <i style={{ background: base.primary }} />
          <i style={{ background: base.accent }} />
          <i style={{ background: base.danger }} />
        </span>
      </span>
    </span>
  );
}

function AutoSwatch() {
  const night = PALETTES.find((p) => p.id === 'night')!;
  return (
    <span class="swatch-split" aria-hidden="true">
      <Swatch base={HARBOR.base} />
      <Swatch base={night.base} />
    </span>
  );
}

/** Color palettes (ported from the calorie tracker) and the animations switch. Both stay on this device. */
export function AppearanceSettings() {
  const { theme, animations } = useData().settings;
  const options = [
    { id: HARBOR.id, name: HARBOR.name, swatch: <Swatch base={HARBOR.base} /> },
    { id: AUTO_THEME, name: 'Auto', swatch: <AutoSwatch /> },
    ...PALETTES.filter((p) => p !== HARBOR).map((p) => ({ id: p.id, name: p.name, swatch: <Swatch base={p.base} /> })),
  ];
  const selected = options.some((o) => o.id === theme) ? theme : HARBOR.id;
  const reduced = systemReducesMotion();

  return (
    <>
      <section class="group-section" aria-labelledby="palette-label">
        <h3 id="palette-label" class="sr-only">
          Color palette
        </h3>
        <div class="palette-grid" role="radiogroup" aria-label="Color palette">
          {options.map((o) => (
            <button type="button" role="radio" aria-checked={o.id === selected} class="palette-option" onClick={() => updateSettings({ theme: o.id })}>
              {o.swatch}
              <span class="palette-name">
                {o.id === selected && <Check size={14} strokeWidth={3} />}
                {o.name}
              </span>
            </button>
          ))}
        </div>
        <p class="group-note">
          {selected === AUTO_THEME
            ? 'Auto uses Harbor by day and Night when your device is in dark mode.'
            : 'Night, Espresso, OLED black and Instrument are dark. The palette is kept on this device only.'}
        </p>
      </section>
      <section class="group-section" aria-label="Motion">
        <div class="group">
          <Switch
            id="motion-switch"
            checked={animations && !reduced}
            label="Animations"
            hint={
              reduced
                ? 'Off while your device’s Reduce Motion setting is on.'
                : animations
                  ? 'Screens slide in, sets pop when checked off, the rest timer glides.'
                  : 'Everything appears instantly.'
            }
            onChange={(on) => updateSettings({ animations: on })}
          />
        </div>
      </section>
    </>
  );
}
