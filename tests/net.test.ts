import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceId, deviceLabel, hash, newId } from '../src/net/device';
import { parseBoards, ScoreSync, shotTuple, type SyncEvent } from '../src/net/scoreSync';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

const device = { id: 'device-test-0001', fingerprint: 'abc', label: 'Linux · Chrome' };
const boards = { runs: [{ runId: 'run-0001-aaaa', name: 'Hudson', score: 50, level: 2 }], levels: [], career: [] };
const ok = (body: unknown = { accepted: 1, rejected: 0, boards }) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const attempt = (n: number): SyncEvent => ({ type: 'attempt', runId: 'run-0001-aaaa', attempt: n, level: n, map: 'Graveyard', score: 25, completed: true });

describe('device identity', () => {
  it('labels common devices, including iPads that claim to be Macs', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const ipadOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
    const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
    const chromeIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1';
    expect(deviceLabel(iphone, 5, false)).toBe('iPhone · Safari');
    expect(deviceLabel(iphone, 5, true)).toBe('iPhone · Home Screen');
    expect(deviceLabel(ipadOS, 5, false)).toBe('iPad · Safari');
    expect(deviceLabel(ipadOS, 0, false)).toBe('Mac · Safari');
    expect(deviceLabel(android, 5, false)).toBe('Android · Chrome');
    expect(deviceLabel(edge, 0, false)).toBe('Windows · Edge');
    expect(deviceLabel(chromeIos, 5, false)).toBe('iPhone · Chrome');
    expect(deviceLabel('', 0, false)).toBe('Device · Browser');
  });

  it('keeps one random id per browser, and still plays without storage', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newId()).not.toBe(newId());
    const mem = memory();
    const first = deviceId(mem);
    expect(deviceId(mem)).toBe(first);
    mem.data.set('halloween-rush:device', '<script>');
    expect(deviceId(mem)).not.toBe('<script>');
    const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); } };
    expect(deviceId(blocked)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('hashes deterministically', () => {
    expect(hash('iPhone|en-US|1170|2532')).toBe(hash('iPhone|en-US|1170|2532'));
    expect(hash('a')).not.toBe(hash('b'));
    expect(hash('x')).toMatch(/^[a-z0-9]{1,32}$/);
  });
});

describe('score sync outbox', () => {
  afterEach(() => vi.useRealTimers());

  it('sends events in order, clears them once stored, and hands over the leaderboards', async () => {
    const sent: unknown[] = [];
    const sync = new ScoreSync(device, memory(), async (_url, init) => {
      sent.push(JSON.parse(String(init.body)));
      return ok();
    });
    const got: unknown[] = [];
    sync.onBoards = (b) => got.push(b);
    sync.record({ type: 'run', id: 'run-0001-aaaa', player: 'Hudson' });
    sync.record(attempt(1));
    await sync.flush();
    await vi.waitFor(() => expect(sync.pending).toBe(0));
    const events = sent.flatMap((b) => (b as { events: SyncEvent[] }).events);
    expect(events.map((e) => e.type)).toEqual(['run', 'attempt']);
    expect((sent[0] as { device: unknown }).device).toEqual(device);
    expect(sync.boards?.runs[0]?.name).toBe('Hudson');
    expect(got.length).toBeGreaterThan(0);
  });

  it('keeps events through a failure and a reload, then delivers them', async () => {
    vi.useFakeTimers();
    const mem = memory();
    let online = false;
    const http = vi.fn(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return ok();
    });
    const first = new ScoreSync(device, mem, http);
    first.record(attempt(1));
    first.record(attempt(2));
    await vi.waitFor(() => expect(http).toHaveBeenCalled());
    await Promise.resolve();
    expect(first.pending).toBe(2);
    // The page is closed and opened again later: the outbox comes back from storage.
    const second = new ScoreSync(device, mem, http);
    expect(second.pending).toBe(2);
    online = true;
    await second.flush();
    expect(second.pending).toBe(0);
    const delivered = http.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(JSON.parse(String(delivered[1].body)).events).toHaveLength(2);
  });

  it('retries a failed send by itself', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const sync = new ScoreSync(device, memory(), async () => {
      calls++;
      if (calls === 1) return new Response('busy', { status: 503 });
      return ok();
    });
    sync.record(attempt(1));
    await vi.waitFor(() => expect(calls).toBe(1));
    expect(sync.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(2);
    expect(sync.pending).toBe(0);
  });

  it('stops trying on a host without the scores API, and never throws', async () => {
    const http = vi.fn(async () => new Response('Not found', { status: 404 }));
    const sync = new ScoreSync(device, memory(), http);
    sync.record(attempt(1));
    await vi.waitFor(() => expect(sync.available).toBe(false));
    sync.record(attempt(2));
    await sync.flush();
    expect(http).toHaveBeenCalledTimes(1);
    expect(sync.boards).toBeNull();
  });

  it('sends a long outbox in small batches, oldest first', async () => {
    const mem = memory();
    mem.setItem('halloween-rush:outbox', JSON.stringify(Array.from({ length: 30 }, (_, i) => attempt(i + 1))));
    const sent: SyncEvent[][] = [];
    const sync = new ScoreSync(device, mem, async (_url, init) => {
      sent.push(JSON.parse(String(init.body)).events);
      return ok();
    });
    await sync.flush();
    expect(sent.map((b) => b.length)).toEqual([25, 5]);
    expect(sent.flat().map((e) => (e.type === 'attempt' ? e.attempt : 0))).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(sync.pending).toBe(0);
  });

  it('sends shots compactly, aim rounded to a thousandth of a radian', () => {
    expect(shotTuple({ ms: 1500, yaw: 0.123456, pitch: -0.0104, target: 'witch', zone: 'far', points: 45 })).toEqual([1500, 0.123, -0.01, 'witch', 'far', 45]);
    expect(shotTuple({ ms: 0, yaw: 1, pitch: 0.5, target: null, zone: null, points: 0 })).toEqual([0, 1, 0.5, null, null, 0]);
  });

  it('reads the Maps board and accuracy, and accepts a host from before them', () => {
    const b = parseBoards({
      runs: [{ runId: 'r', name: 'A', score: 1, level: 1, shots: 4, hits: 3 }],
      levels: [],
      maps: [{ map: 'Graveyard', name: 'A', score: 9, level: 2, runId: 'r', shots: 4, hits: 3 }, { map: 'Graveyard' }],
      career: [{ name: 'A', points: 9, games: 1, best: 9, furthest: 1, maps: [] }],
    });
    expect(b?.runs[0]).toMatchObject({ shots: 4, hits: 3 });
    expect(b?.maps).toEqual([{ map: 'Graveyard', name: 'A', score: 9, level: 2, runId: 'r', shots: 4, hits: 3 }]);
    expect(b?.career[0]).toMatchObject({ shots: 0, hits: 0 });
    expect(parseBoards({ runs: [], levels: [], career: [] })?.maps).toEqual([]);
  });

  it('drops malformed rows from the host', () => {
    expect(parseBoards(null)).toBeNull();
    expect(parseBoards({ runs: [] })).toBeNull();
    const b = parseBoards({
      runs: [{ runId: 'r', name: 'A', score: 1, level: 1 }, { runId: 5, name: 'B' }, null],
      levels: [{ level: 1, map: 'Graveyard', name: 'A', score: 9, runId: 'r' }, { level: '1' }],
      career: [{ name: 'A', points: 9, games: 1, best: 9, furthest: 1, maps: [{ map: 'Graveyard', avg: 9, plays: 1 }, { map: 1 }] }, { name: 'X' }],
    });
    expect(b?.runs).toHaveLength(1);
    expect(b?.levels).toHaveLength(1);
    expect(b?.career).toHaveLength(1);
    expect(b?.career[0]?.maps).toHaveLength(1);
  });
});
