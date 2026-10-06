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
