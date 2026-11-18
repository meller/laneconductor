// REQ-5: a blob sha is git's blob id of exactly the bytes returned:
// sha1("blob " + byteLength + "\0" + bytes). Matches `git hash-object` locally and the tree-entry
// sha on GitHub, so both backends compare the same way.
import { createHash } from 'node:crypto';

export function blobSha(contentOrBytes) {
  const bytes = Buffer.isBuffer(contentOrBytes) ? contentOrBytes : Buffer.from(contentOrBytes, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
