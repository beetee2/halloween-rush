import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** The production origin every absolute URL in the pages and crawler files must use. */
const SITE = 'https://halloweenrush.app';
/** Each indexable URL and the source page Vite builds it from. */
const PAGES: Record<string, string> = { '/': 'index.html', '/about/': 'about/index.html' };

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');

function tagContent(html: string, attr: 'name' | 'property', key: string): string | undefined {
  const m = html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`));
  return m ? decode(m[1]!) : undefined;
}

function jsonLd(html: string): unknown[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));
}

/** The text a visitor sees in <body>: tags, scripts and extra whitespace removed. */
function visibleText(html: string): string {
  const body = html.slice(html.indexOf('<body'));
  return decode(body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
}

describe('search engine metadata', () => {
  for (const [url, file] of Object.entries(PAGES)) {
    describe(file, () => {
      const html = read(file);

      it('has a search-friendly title and description', () => {
        const title = decode(html.match(/<title>([^<]*)<\/title>/)![1]!);
        expect(title).toContain('Halloween Rush');
        expect(title.length).toBeLessThanOrEqual(65);
        const description = tagContent(html, 'name', 'description')!;
        expect(description.length).toBeGreaterThanOrEqual(70);
        expect(description.length).toBeLessThanOrEqual(160);
      });

      it('points canonical and social URLs at the production page', () => {
        expect(html).toContain(`<link rel="canonical" href="${SITE}${url}" />`);
        expect(tagContent(html, 'property', 'og:url')).toBe(`${SITE}${url}`);
        expect(tagContent(html, 'property', 'og:image')).toBe(`${SITE}/og-image.png`);
        expect(tagContent(html, 'name', 'twitter:image')).toBe(`${SITE}/og-image.png`);
        expect(tagContent(html, 'name', 'robots')).toMatch(/^index, follow/);
      });

      it('has valid structured data on this origin', () => {
        const blocks = jsonLd(html);
        expect(blocks.length).toBeGreaterThan(0);
        const urls = JSON.stringify(blocks).match(/https?:\/\/[^"]+/g) ?? [];
        for (const u of urls) if (!u.startsWith('https://schema.org')) expect(u.startsWith(`${SITE}/`)).toBe(true);
      });
    });
  }

  it('FAQ structured data matches the FAQ visitors see', () => {
    const html = read('about/index.html');
    const text = visibleText(html);
    const faq = (jsonLd(html)[0] as { '@graph': Array<{ '@type': string; mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }> }> })['@graph'].find(
      (n) => n['@type'] === 'FAQPage',
    )!;
    expect(faq.mainEntity!.length).toBeGreaterThan(3);
    for (const q of faq.mainEntity!) {
      expect(html).toContain(`<h3>${q.name}</h3>`);
      expect(text).toContain(q.acceptedAnswer.text);
    }
  });

  it('the social preview image is 1200×630', () => {
    const png = readFileSync(new URL('../public/og-image.png', import.meta.url));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});

describe('crawler files', () => {
  it('the sitemap lists exactly the indexable pages', () => {
    const locs = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(Object.keys(PAGES).map((p) => `${SITE}${p}`));
  });

  it('every indexable page is part of the build', () => {
    const vite = read('vite.config.ts');
    for (const file of Object.values(PAGES)) expect(vite).toContain(`'${file}'`);
  });

  it('robots.txt lets every crawler in and names the sitemap', () => {
    const robots = read('public/robots.txt');
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
    for (const bot of ['*', 'GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) expect(robots).toContain(`User-agent: ${bot}\n`);
  });

  it('llms.txt links every indexable page', () => {
    const llms = read('public/llms.txt');
    expect(llms.startsWith('# Halloween Rush\n')).toBe(true);
    for (const p of Object.keys(PAGES)) expect(llms).toContain(`](${SITE}${p})`);
  });

  it('unknown URLs get a real, unindexed 404 page', () => {
    expect(read('wrangler.jsonc')).toContain('"not_found_handling": "404-page"');
    expect(existsSync(new URL('../public/404.html', import.meta.url))).toBe(true);
    expect(read('public/404.html')).toContain('<meta name="robots" content="noindex" />');
  });
});
