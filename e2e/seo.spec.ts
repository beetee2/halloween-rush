import { expect, test } from '@playwright/test';

test('crawler files and the social image are served', async ({ request }) => {
  const files: Array<[string, string]> = [
    ['/robots.txt', 'text/plain'],
    ['/sitemap.xml', 'xml'],
    ['/llms.txt', 'text/plain'],
    ['/og-image.png', 'image/png'],
  ];
  for (const [path, type] of files) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()['content-type'], path).toContain(type);
  }
  // The LAN server sends .ico without a type (browsers don't need one); Cloudflare adds it.
  expect((await request.get('/favicon.ico')).status()).toBe(200);
});

test('the About page reads without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/about/');
  await expect(page.locator('h1')).toContainText('Halloween Rush');
  await expect(page.locator('.faq h3')).toHaveCount(7);
  await context.close();
});

test('the title screen and the About page link to each other', async ({ page }) => {
  await page.goto('/');
  await page.click('.title-link');
  await expect(page).toHaveURL(/\/about\/$/);
  await page.locator('a.btn.big').first().click();
  await expect(page.locator('#screen-title')).toBeVisible();
  await expect(page.locator('#btn-start')).toBeVisible();
});

// Search engines render pages without WebGL; what they index must still describe the game.
test('without WebGL the title still says what the game is', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext as (...args: unknown[]) => unknown;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type.startsWith('webgl') ? null : get.call(this, type, ...rest);
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('#screen-title')).toBeVisible();
  await expect(page.locator('h1')).toHaveText(/Halloween\s+Rush/);
  await expect(page.locator('#title-error')).toContainText('WebGL');
  await expect(page.locator('#btn-reload')).toBeFocused();
  await expect(page.locator('#btn-start')).toBeHidden();
  await expect(page.locator('#title-actions')).toBeHidden();
  await expect(page.locator('.title-link')).toBeVisible();
});
