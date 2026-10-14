import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicDir = new URL('../../public/', import.meta.url);
describe('CCT home-screen icons', () => {
  it('lists two ordinary icons and a separate maskable icon with correct opaque PNG sizes', () => {
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', publicDir), 'utf8'));
    expect(manifest.icons.map((icon: { src: string; purpose: string }) => [icon.src, icon.purpose])).toEqual([
      ['brand/icon-192.png?v=2', 'any'],
      ['brand/icon-512.png?v=2', 'any'],
      ['brand/icon-512-maskable.png?v=2', 'maskable'],
    ]);
    for (const icon of [...manifest.icons, { src: 'brand/apple-touch-icon.png', sizes: '180x180' }]) {
      const png = readFileSync(new URL(icon.src.split('?')[0], publicDir));
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
      expect(png[25]).toBe(2); // PNG RGB, no transparency.
    }
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toContain('brand/apple-touch-icon.png?v=2');
    expect(html).toContain('brand/favicon-32.png?v=2');
  });
});
