// Renders the PNG icons from the SVGs with the preinstalled Chromium: `node scripts/icons.mjs`.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const browser = await chromium.launch();
const page = await browser.newPage();
const render = async (svg, size, out) => {
  await page.setViewportSize({ width: size, height: size });
  const markup = readFileSync(svg, 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};
await render('public/icons/icon.svg', 192, 'public/icons/icon-192.png');
await render('public/icons/icon.svg', 512, 'public/icons/icon-512.png');
// iOS rounds the corners itself and shows transparency as black: a square, edge-to-edge icon.
await render('public/icons/maskable.svg', 180, 'public/icons/apple-touch-icon.png');
await render('public/icons/maskable.svg', 512, 'public/icons/maskable-512.png');
await browser.close();
console.log('Icons written to public/icons/');
