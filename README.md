# huggingface

A library and a CLI tool for accessing HuggingFace.

## Usage

### CLI

```bash
$ npm install -g @frost-beta/huggingface
$ huggingface
━━━ HuggingFace CLI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  $ huggingface <command>

━━━ General commands ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  huggingface download [--to #0] [--filter #0] [--silent] <repo>
    Download models or datasets from repository.

You can also print more details about any of these commands by calling them with 
the `-h,--help` flag right after the command name.
```

### APIs

```ts
async function download(repo: string, dir: string, opts?: {
  showProgress?: boolean;
  filters?: string[];
});
```
