import test from "node:test";
import assert from "node:assert/strict";
import { linkPreviewInternals } from "../../apps/api/src/linkPreviews.js";

test("link preview targets exclude non-public IPv4 addresses and non-web endpoints", () => {
  for (const address of ["8.8.8.8", "1.1.1.1"]) {
    assert.equal(linkPreviewInternals.isPublicIpv4Address(address), true);
  }
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
  ]) {
    assert.equal(linkPreviewInternals.isPublicIpv4Address(address), false, address);
  }
  assert.throws(() =>
    linkPreviewInternals.selectPublicIpv4([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
  );
  assert.equal(
    linkPreviewInternals.selectPublicIpv4([{ address: "93.184.216.34", family: 4 }]),
    "93.184.216.34",
  );

  assert.throws(() => linkPreviewInternals.normalizePublicUrl("http://127.0.0.1/"));
  assert.throws(() => linkPreviewInternals.normalizePublicUrl("http://example.com:8080/"));
  assert.throws(() => linkPreviewInternals.normalizePublicUrl("https://user:pass@example.com/"));
  assert.throws(() => linkPreviewInternals.normalizePublicUrl("https://service.localhost/"));
  assert.equal(linkPreviewInternals.normalizePublicUrl("https://example.com/page#section").href, "https://example.com/page");
});

test("link preview metadata extracts safe text and resolves thumbnail URLs", () => {
  const metadata = linkPreviewInternals.extractMetadata(
    '<meta property="og:title" content="A &amp; B"><meta name="description" content="A useful page"><meta property="og:image" content="/cover.png"><title>Fallback</title>',
    new URL("https://example.com/article"),
  );

  assert.equal(metadata.title, "A & B");
  assert.equal(metadata.description, "A useful page");
  assert.equal(metadata.thumbnailUrl?.href, "https://example.com/cover.png");
});

test("link preview thumbnails reject malformed and excessively large images", () => {
  const image = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(image);
  image.writeUInt32BE(640, 16);
  image.writeUInt32BE(480, 20);
  assert.equal(linkPreviewInternals.imageDimensionsWithinLimit(image, "image/png"), true);

  image.writeUInt32BE(8192, 16);
  assert.equal(linkPreviewInternals.imageDimensionsWithinLimit(image, "image/png"), false);
  assert.equal(linkPreviewInternals.imageDimensionsWithinLimit(Buffer.alloc(24), "image/png"), false);
});
