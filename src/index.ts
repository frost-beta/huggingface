import path from 'node:path';
import {createWriteStream} from 'node:fs';
import fs from 'node:fs/promises';
import {PassThrough} from 'node:stream';
import {pipeline} from 'node:stream/promises';

import {MultiBar, Presets} from 'cli-progress';
import Throttle from 'promise-parallel-throttle';
import picomatch from 'picomatch';
import prettyBytes from 'pretty-bytes';
import * as hub from '@huggingface/hub';

interface DownloadOptions {
  showProgress?: boolean;
  filters?: string[];
};

export async function download(repo: string, dir: string, opts: DownloadOptions = {}) {
  // Create progress bar.
  let bar: MultiBar | undefined = undefined;
  if (opts.showProgress) {
    bar = new MultiBar({
      barsize: 30,
      hideCursor: true,
      gracefulExit: false,  // not reliable, use our own listener below
      format: '{bar} | {name} | {value}/{total}',
      formatValue: (value, _, type) => {
        // Return human friendly file sizes.
        if (type != 'value' && type != 'total')
          return value;
        const options = {
          // Avoid jumping cursors around numbers like 1.9MB and 2MB.
          minimumFractionDigits: value > 1024 * 1024 ? 1 : 0,
          // Keep numbers compact.
          maximumFractionDigits: 1,
          space: false,
        };
        return prettyBytes(value, options);
      },
    }, Presets.shades_grey);
  }
  // Stop the bar when process quits to restore the cursor.
  const exitListener = () => bar?.stop();
  try {
    process.once('exit', exitListener);
    return await downloadRepo(repo, dir, opts.filters, bar);
  } finally {
    process.off('exit', exitListener);
  }
}

async function downloadRepo(repo: string, dir: string, filters?: string[], bar?: MultiBar) {
  // Create glob filter.
  const isMatch = filters?.length ? picomatch(filters) : null;
  // Get files list from hub.
  const filepaths: string[] = [];
  for await (const file of hub.listFiles({repo})) {
    if (!isMatch || isMatch(file.path))
      filepaths.push(file.path);
  }
  if (filepaths.length == 0)
    return;
  // Download all files, Throttle.all limits 5 downloads parallel.
  const tasks = alignNames(filepaths).map(([p, n]) => () => downloadFile(repo, p, n, dir, bar));
  await Throttle.all(tasks);
  bar?.stop();
}

async function downloadFile(repo: string, filepath: string, name: string, dir: string, bar?: MultiBar) {
  // Make sure target dir is created.
  const target = path.join(dir, filepath);
  await fs.mkdir(path.dirname(target), {recursive: true});
  // Download file.
  const response = await hub.downloadFile({repo, path: filepath});
  if (!response) {
    // Only happens for 404 error, should never happen unless server API error.
    return;
  }
  // Setup progress bar.
  const progress = new PassThrough();
  if (bar) {
    const size = parseInt(response.headers.get('Content-Length')!);
    const subbar = bar.create(size, 0);
    progress.on('data', (chunk) => subbar.increment(chunk.length, {name}));
  }
  // Write to disk and wait.
  await pipeline(response.body as any, progress, createWriteStream(target));
}

// Make items in the list have the same length.
function alignNames(names: string[]): [string, string][] {
  // Find the longest length.
  const len = names.reduce((max, name) => Math.max(max, name.length), 0);
  // Pad trailing spaces to names.
  return names.map(name => [name, name.padEnd(len, ' ')]);
}
