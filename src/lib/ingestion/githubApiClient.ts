import { serverEnv } from "@/data/serverEnv";

export interface GitHubApiClientOptions {
  authToken?: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  fetchFn?: typeof fetch;
}

export interface GitHubRepositoryResponse {
  name: string;
  owner: { login: string };
  html_url: string;
  default_branch: string;
  description: string | null;
  language: string | null;
}

export interface GitHubCommitResponse {
  sha: string;
  commit: {
    message: string;
  };
}

export interface GitHubCompareFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed" | "copied" | "changed" | string;
  previous_filename?: string;
}

export interface GitHubCompareResponse {
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  files?: GitHubCompareFile[];
}

/**
 * Dedicated API client for GitHub HTTP operations.
 * Handles authentication, retries with exponential backoff and jitter,
 * rate limit headers, commit metadata, commit comparison, and archive streaming.
 */
export class GitHubApiClient {
  private authToken?: string;
  private maxRetries: number;
  private baseDelayMs: number;
  private maxDelayMs: number;
  private fetchFn: typeof fetch;

  constructor(options?: GitHubApiClientOptions) {
    this.authToken = options?.authToken || serverEnv.GITHUB_TOKEN;
    this.maxRetries = options?.maxRetries ?? 3;
    this.baseDelayMs = options?.baseDelayMs ?? 1000;
    this.maxDelayMs = options?.maxDelayMs ?? 10000;
    this.fetchFn = options?.fetchFn ?? fetch;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": "Vercel-Workflow-Ingestion-Engine",
      Accept: "application/vnd.github+json",
    };
    if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  private isTransientStatus(status: number): boolean {
    return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  private isTransientError(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      return (
        msg.includes("econnreset") ||
        msg.includes("etimedout") ||
        msg.includes("fetch failed") ||
        msg.includes("network") ||
        msg.includes("aborted")
      );
    }
    return false;
  }

  /**
   * Performs an HTTP request with automated retry on transient failures.
   */
  public async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    let attempt = 0;

    while (true) {
      const headers = { ...this.getHeaders(), ...(init?.headers as Record<string, string>) };

      try {
        const response = await this.fetchFn(url, { ...init, headers });

        if (response.ok) {
          return response;
        }

        if (!this.isTransientStatus(response.status) || attempt >= this.maxRetries) {
          return response;
        }

        attempt++;
        let delay = this.baseDelayMs * Math.pow(2, attempt - 1);
        const retryAfter = response.headers.get("Retry-After");
        if (retryAfter) {
          const parsed = parseInt(retryAfter, 10);
          if (!isNaN(parsed)) {
            delay = parsed * 1000;
          }
        } else {
          // Exponential backoff with random jitter
          delay += Math.floor(Math.random() * 500);
        }

        delay = Math.min(delay, this.maxDelayMs);
        console.warn(
          `[GitHubApiClient Warning] Status ${response.status} for ${url}. Retrying attempt ${attempt}/${this.maxRetries} after ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        if (!this.isTransientError(error) || attempt >= this.maxRetries) {
          throw error;
        }
        attempt++;
        const delay = Math.min(
          this.baseDelayMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500),
          this.maxDelayMs,
        );
        console.warn(
          `[GitHubApiClient Warning] Network error '${(error as Error).message}' for ${url}. Retrying attempt ${attempt}/${this.maxRetries} after ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Fetches repository metadata.
   */
  public async getRepository(owner: string, repo: string): Promise<GitHubRepositoryResponse> {
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    const res = await this.fetchWithRetry(url);
    if (!res.ok) {
      throw new Error(`GitHub API returned status ${res.status} for repository ${owner}/${repo}`);
    }
    return (await res.json()) as GitHubRepositoryResponse;
  }

  /**
   * Fetches target commit info (by branch, tag, or SHA).
   */
  public async getCommit(owner: string, repo: string, ref: string): Promise<GitHubCommitResponse> {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`;
    const res = await this.fetchWithRetry(url);
    if (!res.ok) {
      throw new Error(
        `GitHub API returned status ${res.status} for commit ${owner}/${repo}@${ref}`,
      );
    }
    return (await res.json()) as GitHubCommitResponse;
  }

  /**
   * Compares two commits to discover changed, added, or removed files.
   * Returns null if comparison fails (e.g. force push or diverged history).
   */
  public async compareCommits(
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<GitHubCompareResponse | null> {
    const url = `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}`;
    const res = await this.fetchWithRetry(url);
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as GitHubCompareResponse;
  }

  /**
   * Downloads tarball stream for a specific revision (branch, tag, or SHA).
   */
  public async downloadArchiveStream(owner: string, repo: string, ref: string): Promise<Response> {
    const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`;
    const res = await this.fetchWithRetry(url, { redirect: "follow" });
    if (!res.ok || !res.body) {
      throw new Error(`Failed to download tarball from ${url}: Status ${res.status}`);
    }
    return res;
  }
}
