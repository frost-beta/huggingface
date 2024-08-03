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

  huggingface login
    Set credentials for huggingface.

  huggingface whoami
    Show current user.

You can also print more details about any of these commands by calling them with 
the `-h,--help` flag right after the command name.
```

### APIs

```ts
import * as hub from '@huggingface/hub';

export interface DownloadOptions {
    revision?: string;
    showProgress?: boolean;
    filters?: string[];
    parallel?: number;
}
export declare function download(repo: string, dir: string, opts?: DownloadOptions): Promise<void>;

export declare class NotLoggedInError extends Error {}
export declare function whoami(): Promise<hub.WhoAmI>;

export declare function getCredentials(): hub.Credentials | undefined;
export declare function getAccessToken(): string | undefined;
export declare function getAccessTokenPath(): string;
```
