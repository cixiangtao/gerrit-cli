export type SyncStrategy = "ff-only" | "merge" | "rebase";

export interface GerritCliConfig {
  /** Git remote used to fetch and push changes. */
  remote?: string;
  /** Gerrit target branch. Defaults to the current branch's upstream branch. */
  targetBranch?: string;
  /** Strategy used when the remote target has commits missing locally. */
  syncStrategy?: SyncStrategy;
  /** Gerrit browser base URL, such as https://gerrit.example.com. */
  webUrl?: string;
  /** Reviewers appended to every review push. */
  reviewers?: string[];
  /** CC recipients appended to every review push. */
  cc?: string[];
}

export interface EffectiveConfig {
  remote?: string;
  targetBranch?: string;
  syncStrategy: SyncStrategy;
  webUrl?: string;
  reviewers: string[];
  cc: string[];
  sources: string[];
}

export interface GlobalOptions {
  cwd: string;
  json: boolean;
}

export interface CommandEnvelope<T> {
  ok: true;
  command: string;
  data: T;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    hints: string[];
  };
}
