/**
 * Post-build step: copy static assets into dist/ and create download zips.
 * Runs on Heroku via heroku-postbuild.
 */
import { cp, mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

async function zipDir(srcDir, zipPath, { recursive = false, prefix = '' } = {}) {
  const zip = new JSZip();
  async function addDir(dir, rel) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (recursive) await addDir(abs, r);
      } else {
        zip.file(prefix + r, await readFile(abs));
      }
    }
  }
  await addDir(srcDir, '');
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await writeFile(zipPath, buf);
  console.log(`wrote ${zipPath} (${(buf.length / 1024).toFixed(0)} KB)`);
}

// 1. Copy static assets used at runtime
await cp(join(root, 'sprites'), join(dist, 'sprites'), { recursive: true });
await cp(join(root, 'presets'), join(dist, 'presets'), { recursive: true });

// 2. Download zips
const dlDir = join(dist, 'downloads');
await mkdir(dlDir, { recursive: true });
await zipDir(join(dist, 'lib'), join(dlDir, 'particle-beast-lib.zip'), { recursive: true });
await zipDir(join(root, 'presets'), join(dlDir, 'presets.zip'), { prefix: 'presets/' });
await zipDir(join(root, 'sprites'), join(dlDir, 'sprites.zip'), { recursive: true, prefix: 'sprites/' });

console.log('postbuild complete');
