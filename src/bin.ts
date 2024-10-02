#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {Builtins, Cli, Command, Option} from 'clipanion';
import {NotLoggedInError, download, whoami, getAccessTokenPath, getPackageJson} from './index.js';

export class DownloadCommand extends Command {
  static paths = [ [ 'download' ] ];
  static usage = Command.Usage({
    description: 'Download models or datasets from repository.',
    details: 'For downloading datasets, put "datasets/" before the name, for example "datasets/wikitext"',
    examples: [
      [
        'Download all files to Llama3-ChatQA-1.5-8B dir',
        '$0 download nvidia/Llama3-ChatQA-1.5-8B',
      ],
      [
        'Download only .json and .safetensors files to /tmp/weights',
        '$0 download --to /tmp/weights --filter=*.json --filter=*.safetensors nvidia/Llama3-ChatQA-1.5-8B',
      ],
      [
        'Download datasets',
        '$0 download datasets/wikitext',
      ],
    ]
  });

  repo = Option.String();
  dir = Option.String('--to', {description: 'Target directory to put downloaded files, default is repo\'s name'});
  revision = Option.String('--revision', {description: 'The revision of the repo'});
  filters = Option.Array('--filter', {description: 'Only download files matching glob patterns'});
  hf = Option.Boolean('--hf', {description: 'Only download hf format model files (*.safetensors, *.json, *.txt)'});
  silent = Option.Boolean('--silent', {description: 'Do not print progress bar'});

  async execute() {
    const dir = this.dir ?? this.repo.split('/').pop();
    if (!this.respo.startsWith('datasets') && this.hf)
      this.filters = [ '*.safetensors', '*.json', '*.txt' ];
    await download(this.repo, dir!, {
      revision: this.revision,
      showProgress: !this.silent,
      filters: this.filters,
    });
  }
}

export class LoginCommand extends Command {
  static paths = [ [ 'login' ] ];
  static usage = Command.Usage({description: 'Set credentials for huggingface.'});

  async execute() {
    console.log('To login, generate a token from https://huggingface.co/settings/tokens .');
    const rl = createInterface({input: process.stdin, output: process.stdout});
    const token = await rl.question('Enter your token: ');
    const accessTokenPath = getAccessTokenPath();
    fs.mkdirSync(path.dirname(accessTokenPath), {recursive: true});
    fs.writeFileSync(accessTokenPath, token);
  }
}

export class WhoamiCommand extends Command {
  static paths = [ [ 'whoami' ] ];
  static usage = Command.Usage({description: 'Show current user.'});

  async execute() {
    try {
      const info = await whoami();
      console.log(info.name);
    } catch (error) {
      if (error instanceof NotLoggedInError)
        console.log(error.message);
      else
        console.error(error);
      process.exit(1);
    }
  }
}

const cli = new Cli({
  binaryName: `huggingface`,
  binaryLabel: 'HuggingFace CLI',
  binaryVersion: getPackageJson().version,
});

cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);
cli.register(DownloadCommand);
cli.register(LoginCommand);
cli.register(WhoamiCommand);
cli.runExit(process.argv.slice(2)).then(() => process.exit());
