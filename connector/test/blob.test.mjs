import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { blobSha } from '../src/blob.mjs';

const gitHash = (buf) => execFileSync('git', ['hash-object', '--stdin'], { input: buf }).toString().trim();

// TC-2.1
for (const [label, content] of [
  ['ascii', 'hello world\n'],
  ['utf-8 multibyte', 'héllo – 世界 🌍\n'],
  ['empty', ''],
  ['crlf', 'a\r\nb\r\n'],
]) {
  test(`blobSha equals git hash-object for ${label}`, () => {
    assert.equal(blobSha(content), gitHash(Buffer.from(content, 'utf8')));
  });
}

test('blobSha accepts a Buffer and hashes its bytes', () => {
  const buf = Buffer.from([0xff, 0xfe, 0x00, 0x41]);
  assert.equal(blobSha(buf), gitHash(buf));
});
