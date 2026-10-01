import { expect, test } from '@playwright/test';
import { fresh, watchErrors } from './helpers';

const TOKEN = 'A'.repeat(30) + 'b'.repeat(30);

test('Use with Claude: my connector address, the Desktop extension, and my own server', async ({ page, context }) => {
  const errors = watchErrors(page);
  await fresh(page);
  const asked: { host: string; body: string }[] = [];
  await context.route(/https:\/\/[^/]+\/link$/, async (route) => {
    asked.push({ host: new URL(route.request().url()).host, body: route.request().postData() ?? '' });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ token: TOKEN }) });
  });

  // Without sync, it says to turn it on first.
  await page.goto('./#/settings');
  await expect(page.getByText(/Turn on Sync between devices first/)).toBeVisible();

  // With sync on (here: a relay that can't be reached, so nothing leaves the test).
  await page.evaluate(() =>
    localStorage.setItem(
      'gym-tracker:sync',
      JSON.stringify({ phrase: 'legal winner thank year wave sausage worth useful legal winner thank yellow', relays: ['ws://127.0.0.1:1'], seen: {}, lastSyncAt: 0, devices: {} }),
    ),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Show my connector address' }).click();
  const address = page.locator('.connector-url');
  await expect(address).toHaveText(new RegExp(`^https://gym\\.xaxaxage\\.vercel\\.app/mcp/${TOKEN}\\?tz=[^&]+&r=ws://127\\.0\\.0\\.1:1$`));
  expect(asked[0]).toMatchObject({ host: 'gym.xaxaxage.vercel.app' });
  expect(JSON.parse(asked[0].body).syncKey).toMatch(/^legal winner/);
  await expect(page.getByRole('button', { name: 'Copy the address' })).toBeVisible();
  await expect(page.getByText(/Customize → Connectors/)).toBeVisible();

  // The Desktop extension downloads from the app's own site.
  await page.getByText('Claude Desktop extension (runs on your computer)').click();
  const link = page.getByRole('link', { name: 'Download the Claude Desktop extension' });
  await expect(link).toHaveAttribute('href', './mcp/gym-tracker.mcpb');
  const res = await page.request.get('./mcp/gym-tracker.mcpb');
  expect(res.status()).toBe(200);
  expect((await res.body()).subarray(0, 2).toString()).toBe('PK');

  // Your own server: a bare domain works (the field isn't type=url, which would refuse it).
  await page.getByText('Use your own connector server').click();
  const host = page.getByLabel('Your connector server');
  await expect(host).toHaveAttribute('type', 'text');
  await expect(host).toHaveAttribute('inputmode', 'url');
  await host.fill('my-gym-connector.vercel.app');
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await page.getByRole('button', { name: 'Show my connector address' }).click();
  await expect(address).toContainText('https://my-gym-connector.vercel.app/mcp/');
  expect(asked.at(-1)?.host).toBe('my-gym-connector.vercel.app');
  expect(errors.filter((e) => !/WebSocket|ERR_/.test(e))).toEqual([]);
});
