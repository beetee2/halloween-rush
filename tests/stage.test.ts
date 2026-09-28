import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { PixelRatioCap } from '../src/render/stage';

/** Play `sec` seconds at `fps` drawn at pixel ratio `current`; the cap after each sample. */
function play(cap: PixelRatioCap, fps: number, sec: number, current: () => number): number[] {
  const out: number[] = [];
  for (let t = 0; t < sec * fps; t++) if (cap.frame(1 / fps, current())) out.push(cap.value);
  return out;
}

describe('adaptive resolution', () => {
  const { maxPixelRatio, minFps, sampleSec, pixelRatioStep, minPixelRatio } = CONFIG.render;

  it('keeps full resolution while play is smooth', () => {
    const cap = new PixelRatioCap();
    expect(play(cap, 60, 20, () => cap.value)).toEqual([]);
    expect(cap.value).toBe(maxPixelRatio);
  });

  it('steps down while slow, as long as each step helps', () => {
    const cap = new PixelRatioCap();
    // Fewer pixels, more frames: slow at 2x and 1.5x, smooth at 1x.
    const fpsAt: Record<number, number> = { [maxPixelRatio]: minFps / 2, [maxPixelRatio - pixelRatioStep]: minFps * 0.7, [minPixelRatio]: minFps * 1.5 };
    const changes: number[] = [];
    for (let t = 0; t < sampleSec * 10; ) {
      const dt = 1 / fpsAt[cap.value]!;
      t += dt;
      if (cap.frame(dt, cap.value)) changes.push(cap.value);
    }
    expect(changes).toEqual([maxPixelRatio - pixelRatioStep, minPixelRatio]);
  });

  it("undoes a step that doesn't help (a 30 fps battery-saver cap) and then stays put", () => {
    const cap = new PixelRatioCap();
    expect(play(cap, 30, sampleSec * 4, () => cap.value)).toEqual([maxPixelRatio - pixelRatioStep, maxPixelRatio]);
    expect(play(cap, 20, sampleSec * 4, () => cap.value)).toEqual([]);
  });

  it('never goes below the minimum or changes a screen already drawn at it', () => {
    const cap = new PixelRatioCap();
    expect(play(cap, 10, sampleSec * 3, () => minPixelRatio)).toEqual([]);
    expect(cap.value).toBe(maxPixelRatio);
  });
});
