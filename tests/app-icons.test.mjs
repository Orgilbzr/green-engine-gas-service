import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const png = (path) => { const b = readFileSync(path); assert.equal(b.subarray(1, 4).toString(), "PNG"); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("app icon derivatives have the declared dimensions", () => {
  for (const [file, size] of [["favicon-16", 16], ["favicon-32", 32], ["favicon-48", 48], ["apple-touch-icon", 180], ["icon-192", 192], ["icon-512", 512], ["icon-maskable-512", 512]]) {
    assert.deepEqual(png(`public/icons/${file}.png`), [size, size], file);
  }
});

test("favicon.ico contains 16, 32 and 48 px images", () => {
  const b = readFileSync("public/favicon.ico");
  assert.equal(b.readUInt16LE(2), 1);
  assert.deepEqual([0, 1, 2].map(i => b[6 + i * 16]), [16, 32, 48]);
});

test("layout and manifest reference the icon files", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  for (const url of ["/favicon.ico", "/icons/favicon-32.png", "/icons/apple-touch-icon.png"]) assert.ok(layout.includes(url), url);
  assert.ok(layout.includes('title:"Грийн Энжин Газ сервис"'));
  const manifest = readFileSync("app/manifest.ts", "utf8");
  for (const url of ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"]) assert.ok(manifest.includes(url), url);
});

test("sidebar derivative preserves source alpha and all colors except the dark blue gear", async () => {
  const { default: sharp } = await import('sharp');
  const { createHash } = await import('node:crypto');
  const source = readFileSync('public/green-engine-icon.png');
  assert.equal(createHash('sha256').update(source).digest('hex'), '8b15c08202ac52a4a8bc3ee49de271f66693803ae62f0b1a67556814c6521139');
  const original = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sidebar = await sharp('public/green-engine-sidebar-icon.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(sidebar.info, original.info);
  let changed = 0;
  for (let i = 0; i < original.data.length; i += 4) {
    const a = original.data.subarray(i, i + 4), b = sidebar.data.subarray(i, i + 4);
    assert.equal(b[3], a[3], `alpha at pixel ${i / 4}`);
    if (!a.equals(b)) {
      changed++;
      assert.ok(a[3] > 0 && a[2] > a[1] && a[2] > a[0] && a[2] < 170);
      assert.deepEqual([...b.subarray(0, 3)], [125, 211, 252]);
    }
  }
  assert.ok(changed > 100000);
});
