import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';
test('example shelf, filters, detail and responsive layout', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('Opening your shelf…')).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Imagine your medal shelf.' })).toBeVisible();
  await expect(page.locator('.medal-card')).toHaveCount(5);
  await page.getByRole('button', { name: 'Half marathon', exact: true }).click();
  await expect(page.locator('.medal-card')).toHaveCount(1);
  await page.locator('.medal-card').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Jeju Half Marathon' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'All medals', exact: true }).click();
  for (const width of info.project.name === 'mobile' ? [320, 375, 390, 430] : [1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.screenshot({ path: `test-results/${info.project.name}-shelf.png`, fullPage: true });
  expect(errors).toEqual([]);
});
test('photo upload, cleanup, save, reload, edit, share and delete', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.getByText('Opening your shelf…')).not.toBeVisible();
  await page.getByRole('button', { name: 'Add a medal', exact: true }).first().click();
  const png = await sharp({
    create: { width: 400, height: 400, channels: 4, background: '#ffffff' },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="400" height="400"><circle cx="200" cy="220" r="115" fill="#b78c36"/><path d="M150 0H185L225 130H190Z" fill="#b34f40"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'medal.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText('Your medal preview')).toBeVisible();
  await page.getByRole('button', { name: 'Remove background', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use cutout' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Race name').fill('My test marathon');
  await page.getByLabel('Finish time').fill('03:42:17');
  await page.getByLabel('Location').fill('Seoul');
  await page.getByLabel('A memory to keep').fill('Made it to the finish line.');
  await page.getByRole('button', { name: 'Save to my shelf' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.medal-card')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.medal-card')).toHaveCount(1);
  await page.locator('.medal-card').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Race name').fill('A finish to remember');
  await page.getByRole('button', { name: 'Save to my shelf' }).click();
  await expect(page.getByRole('heading', { name: 'A finish to remember' })).toBeVisible();
  await page.locator('.medal-card').click();
  await page.getByRole('button', { name: 'Share this finish' }).click();
  await expect(page.getByRole('link', { name: 'Download image' })).toHaveAttribute(
    'href',
    /^blob:/,
  );
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download image' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const metadata = await sharp(path!).metadata();
  expect(metadata.width).toBe(1080);
  expect(metadata.height).toBe(1920);
  await page.getByRole('button', { name: 'Square', exact: true }).click();
  await expect(page.locator('.share-preview.square')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download image' })).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  const squarePromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download image' }).click();
  const square = await squarePromise;
  const squareMeta = await sharp((await square.path())!).metadata();
  expect(squareMeta.width).toBe(1080);
  expect(squareMeta.height).toBe(1080);
  await page.screenshot({ path: `test-results/${info.project.name}-share.png`, fullPage: true });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('.medal-card').click();
  await page.getByRole('button', { name: 'Delete medal' }).click();
  await page.getByRole('button', { name: 'Remove medal' }).click();
  await expect(page.locator('.medal-card')).toHaveCount(0);
  await page.reload();
  // Persisting an intentionally empty collection must not bring demo records back.
  await expect(page.getByRole('heading', { name: 'Your medal shelf.' })).toBeVisible();
});
test('keyboard dialogs and accessibility', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Opening your shelf…')).not.toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Add a medal', exact: true }).first().click();
  const dialogResults = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    dialogResults.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
    })),
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
test('private routes and malformed uploads fail safely', async ({ request }) => {
  expect((await request.get('/u/not-a-public-runner')).status()).toBe(404);
  expect((await request.get('/api/public-image?handle=runner&medal=not-a-uuid')).status()).toBe(
    404,
  );
  expect((await request.get('/api/maintenance')).status()).toBe(401);
  const response = await request.post('/api/images/normalize', {
    multipart: {
      image: { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
    },
  });
  expect(response.status()).toBe(422);
});

test('profile backup download and restore preserves photos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Opening your shelf…')).not.toBeVisible();
  await page.getByRole('button', { name: 'Open profile' }).click();
  await page.getByLabel('Display name').fill('Mina');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByText('Profile saved.')).toBeVisible();
  const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: '#bd963c' } })
    .png()
    .toBuffer();
  const backup = {
    version: 1,
    medals: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        raceName: 'Restored finish',
        date: '2025-03-16',
        distance: 10,
        duration: '',
        location: 'Seoul',
        note: 'A memory',
        image: `data:image/png;base64,${png.toString('base64')}`,
        visibility: 'public',
        color: '#eeeeee',
        createdAt: '2025-03-16T12:00:00Z',
      },
    ],
  };
  await page.locator('input[type=file]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByText('Restored 1 medals.', { exact: false })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download collection backup' }).click();
  const download = await downloadPromise;
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(data.profile.name).toBe('Mina');
  expect(data.medals[0].visibility).toBe('private');
  expect(data.medals[0].image).toMatch(/^data:image\/png;base64,/);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('heading', { name: 'Restored finish' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Restored finish' })).toBeVisible();
});
