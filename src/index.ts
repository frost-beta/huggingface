import path from 'node:path';
import {mkdirSync, createWriteStream} from 'node:fs';
import {PassThrough} from 'node:stream';
import {pipeline} from 'node:stream/promises';

import {MultiBar, Presets, SingleBar} from 'cli-progress';
import Throttle from 'promise-parallel-throttle';
import picomatch from 'picomatch';
import prettyBytes from 'pretty-bytes';
import * as hub from '@huggingface/hub';

interface DownloadOptions {
  showProgress?: boolean;
  filters?: string[];
  parallel?: number;
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
          return String(value);
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
    // Start downloading.
    const parallel = Math.min(opts.parallel ?? 8, process.stdout.rows ?? 8);
    return await downloadRepo(repo, dir, parallel, opts.filters, bar);
  } finally {
    process.off('exit', exitListener);
  }
}

async function downloadRepo(repo: string, dir: string, parallel: number, filters?: string[], bar?: MultiBar) {
  // Create glob filter.
  const isMatch = filters?.length ? picomatch(filters) : null;
  // Get files list from hub.
  const files: hub.ListFileEntry[] = [];
  for await (const file of hub.listFiles({repo, recursive: true})) {
    if (!isMatch || isMatch(file.path))
      files.push(file);
  }
  if (files.length == 0)
    return;
  // Sort the files by size and then get paths.
  const filepaths = files.sort((a, b) => a.size - b.size).map(f => f.path);
  // Download all files, Throttle.all limits 5 downloads parallel.
  const tasks = alignNames(filepaths).map(([p, n]) => {
    return () => downloadFile(repo, p, n, dir, parallel, bar);
  });
  await Throttle.all(tasks, {maxInProgress: parallel});
  bar?.stop();
}

async function downloadFile(repo: string, filepath: string, name: string, dir: string, parallel: number, bar?: MultiBar) {
  // Make sure target dir is created. Use sync version otherwise the sequence
  // of download will be messed.
  const target = path.join(dir, filepath);
  mkdirSync(path.dirname(target), {recursive: true});
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
    let subbar: SingleBar;
    let bars = (bar as any).bars as SingleBar[];
    if (bars.length < parallel) {
      subbar = bar.create(size, 0);
    } else {
      // Reuse finished bar, otherwise things will break when the number of bars
      // exceeds the screen height.
      subbar = bars.findLast(b => !(b as any).isActive)!;
      subbar.start(size, 0);
    }
    progress.on('data', (chunk) => subbar.increment(chunk.length, {name}));
    progress.on('end', () => subbar.stop());
  }
  // Write to disk and wait.
  await pipeline(response.body as any, progress, createWriteStream(target));
}

// Make items in the list have the same length.
function alignNames(names: string[]): [string, string][] {
  // Find the longest length.
  let len = names.reduce((max, name) => Math.max(max, name.length), 0);
  len = Math.min(len, process.stdout.columns - 55);
  // Pad trailing spaces to names.
  return names.map(name => [name, name.padEnd(len, ' ')]);
}
