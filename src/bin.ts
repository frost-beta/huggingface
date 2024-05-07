#!/usr/bin/env node --no-warnings=ExperimentalWarning

import {Builtins, Cli, Command, Option} from 'clipanion';
import {download} from './index.js';
import packageJson from '../package.json' with {type: 'json'};

export class DownloadCommand extends Command {
  static paths = [ [ 'download' ] ];
  static usage = Command.Usage({
    description: 'Download models or datasets from repository.',
    examples: [
      [
        'Download all files to current dir',
        '$0 download nvidia/Llama3-ChatQA-1.5-8B',
      ],
      [
        'Download only .json and .safetensors files to /tmp',
        '$0 download --to /tmp --filter=*.json --filter=*.safetensors nvidia/Llama3-ChatQA-1.5-8B',
      ],
    ]
  });

  repo = Option.String();
  dir = Option.String('--to', process.cwd(), {description: 'Target directory to put downloaded files, default is current working dir'});
  filters = Option.Array('--filter', {description: 'Only download files matching glob patterns'});
  silent = Option.Boolean('--silent', {description: 'Do not print progress bar'});

  async execute() {
    await download(this.repo, this.dir, {showProgress: !this.silent, filters: this.filters});
  }
}

const cli = new Cli({
  binaryName: `huggingface`,
  binaryLabel: 'HuggingFace CLI',
  binaryVersion: packageJson.version,
});

cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);
cli.register(DownloadCommand);
cli.runExit(process.argv.slice(2)).then(() => process.exit());
