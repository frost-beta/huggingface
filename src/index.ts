import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFileSync} from 'node:child_process';

import {Bar, BarItem, Progress, presets} from 'ku-progress-bar';
import picomatch from 'picomatch';
import prettyBytes from 'pretty-bytes';
import * as queue from '@henrygd/queue';
import * as hub from '@huggingface/hub';

export interface DownloadOptions {
  revision?: string;
  showProgress?: boolean;
  filters?: string[];
  parallel?: number;
};

export async function download(repo: string, dir: string, opts: DownloadOptions = {}) {
  // Create progress bar.
  let bar: Bar | undefined;
  if (opts.showProgress) {
    bar = new Bar(undefined, {refreshTimeMs: 100});
  }
  // Start downloading.
  const credentials = getCredentials();
  const parallel = Math.min(opts.parallel ?? 8, process.stdout.rows ?? 8);
  return await downloadRepo(repo, dir, parallel, credentials,
                            opts.filters, opts.revision, bar);
}

async function downloadRepo(repo: string,
                            dir: string,
                            parallel: number,
                            credentials?: hub.Credentials,
                            filters?: string[],
                            revision?: string,
                            bar?: Bar) {
  // Create glob filter.
  const isMatch = filters?.length ? picomatch(filters, {basename: true}) : null;
  // Get files list from hub.
  const files: hub.ListFileEntry[] = [];
  for await (const file of hub.listFiles({credentials, repo, revision: revision?.replaceAll('/', '%2F'), recursive: true})) {
    if (file.type == 'file' && (!isMatch || isMatch(file.path)))
      files.push(file);
  }
  if (files.length == 0)
    return;
  // Sort the files by size and then get paths.
  const filepaths = files.sort((a, b) => a.size - b.size).map(f => f.path);
  // Download all files in parallel.
  const tasks = queue.newQueue(parallel);
  for (const [ filepath, name ] of alignNames(filepaths)) {
    tasks.add(() => downloadFile(repo, filepath, name, dir, parallel, credentials, revision, bar));
  }
  await tasks.done();
  bar?.stop();
}

async function downloadFile(repo: string,
                            filepath: string,
                            name: string,
                            dir: string,
                            parallel: number,
                            credentials?: hub.Credentials,
                            revision?: string,
                            bar?: Bar) {
  // Make sure target dir is created. Use sync version otherwise the sequence
  // of download will be messed.
  const target = path.join(dir, filepath);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  // Download file.
  const response = await hub.downloadFile({credentials, repo, revision, path: filepath});
  if (!response) {
    // Only happens for 404 error, should never happen unless server API error.
    return;
  }
  // Setup progress bar.
  const progress = new PassThrough();
  if (bar) {
    const total = parseInt(response.headers.get('Content-Length')!);
    const subbar = createSingleBar(bar, name, total, parallel);
    progress.on('data', (chunk) => subbar.increment(chunk.length));
    progress.on('end', () => {
      subbar.set(total, {name});
      // Without this the last update may not show on exit.
      bar.render();
    });
  }
  // Write to disk and wait.
  await pipeline(response.body as any, progress, fs.createWriteStream(target));
}

export class NotLoggedInError extends Error {}

export async function whoami(): Promise<hub.WhoAmI> {
  const credentials = getCredentials();
  if (!credentials)
    throw new NotLoggedInError('Not logged in');
  return await hub.whoAmI({credentials});
}

export function fixTokenizer(dir: string) {
  const script = path.resolve(`${__dirname}/../re-export-tokenizer-json.py`);
  try {
    execFileSync(script, [dir], {stdio: 'pipe'});
  } catch (error: any) {
    if (error.stderr?.toString().includes("ModuleNotFoundError: No module named 'transformers'"))
      throw new Error('You must have the "Transformers" python package installed to save tokenizer');
    else
      throw error;
  }
}

// Make items in the list have the same length.
function alignNames(names: string[]): [string, string][] {
  // Find the longest length.
  let len = names.reduce((max, name) => Math.max(max, name.length), 0);
  len = Math.min(len, process.stdout.columns - 55);
  // Pad trailing spaces to names.
  return names.map(name => [name, name.padEnd(len, ' ')]);
}

// Create credentials object.
export function getCredentials(): hub.Credentials | undefined {
  const accessToken = getAccessToken();
  if (accessToken)
    return {accessToken};
  else
    return;
}

// Get the access token.
export function getAccessToken(): string | undefined {
  if (process.env.HF_TOKEN)
    return process.env.HF_TOKEN;
  try {
    return fs.readFileSync(getAccessTokenPath()).toString();
  } catch {
    return undefined;
  }
}

// Get the path to access token file.
export function getAccessTokenPath(): string {
  const cacheDir = process.env.HF_HOME ?? `${getHomeDir()}/.cache/huggingface`;
  return `${cacheDir}/token`;
}

// require('../package.json')
export function getPackageJson(): {version: string} {
  return JSON.parse(String(fs.readFileSync(`${__dirname}/../package.json`)));
}

// Get the ~ dir.
function getHomeDir(): string {
  // Must follow the code at:
  // https://github.com/huggingface/huggingface_hub/blob/97d5ef603f41314a52eb2d045ec966cf9fed6295/src/huggingface_hub/constants.py#L110
  return process.env.XDG_CACHE_HOME ?? os.homedir();
}

// Create a single progress bar.
function createSingleBar(bar: Bar, name: string, total: number, parallel: number) {
  const subbars = (bar as any).items as BarItem[];
  let progress: Progress;
  if (subbars.length < parallel) {
    let lastUpdate = Date.now() - 1000;
    let lastEta = 'Waiting';
    // Create progress bar and add it to group.
    progress = new Progress({total});
    progress.set(0, {name});
    bar.add(new BarItem(progress, {
      options: Object.assign(presets.shades, {
        width: 15,
      }),
      template: ({bar, value, total, etaHumanReadable}) => {
        const valueNumber = parseInt(value);
        const totalNumber = parseInt(total);
        const isFinished = valueNumber >= totalNumber;
        // Do not refresh eta too often.
        if (valueNumber == 0 || Date.now() - lastUpdate < 2000) {
          etaHumanReadable = lastEta;
        } else {
          lastUpdate = Date.now();
          lastEta = String(etaHumanReadable);
        }
        const eta = isFinished ? '' : ` | ETA: ${etaHumanReadable}`;
        // The name may change, get it from payload.
        const name = (progress.getPayload() as any).name as string;
        // Print pretty size.
        const bytesOptions = {
          // Avoid jumping cursors around numbers like 1.9MB and 2MB.
          minimumFractionDigits: valueNumber > 1024 * 1024 ? 1 : 0,
          // Keep numbers compact.
          maximumFractionDigits: 1,
          space: false,
        };
        value = prettyBytes(valueNumber, bytesOptions);
        total = prettyBytes(totalNumber, bytesOptions);
        const percent = isFinished ? total : `${value}/${total}`;
        return `${bar} | ${name} | ${percent}${eta}`;
      },
    }));
  } else {
    // Reuse finished bar, otherwise things will break when the number of bars
    // exceeds the screen height.
    progress = subbars.findLast(b => {
      const p = b.getProgresses()[0];
      return p.getValue() >= p.getTotal();
    })!.getProgresses()[0] as Progress;
    progress.setTotal(total);
    progress.set(0, {name});
  }
  // Start after a subbar is ready so there is no jumping new line.
  if (!(bar as any).isStarted)
    bar.start();
  return progress;
}
