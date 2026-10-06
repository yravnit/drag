import fs from "fs";
import path from "path";
import os from "os";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import * as tar from "tar";
import { GitHubApiClient } from "./githubApiClient";

export interface RepositoryMetadata {
  githubId?: bigint | number | null;
  name: string;
  owner: string;
  url: string;
  defaultBranch: string;
  description: string | null;
  primaryLanguage: string | null;
  headCommitSha: string | null;
  revision?: string;
  isPrivate?: boolean;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
}

export interface AcquiredRepository {
  metadata: RepositoryMetadata;
  workspacePath: string;
  cleanup: () => Promise<void>;
}

export interface AcquireOptions {
  authToken?: string;
  revision?: string;
  apiClient?: GitHubApiClient;
}

interface RepositoryProvider {
  acquire(
    owner: string,
    repo: string,
    options?: string | AcquireOptions,
  ): Promise<AcquiredRepository>;
}

export class GitHubArchiveRepositoryProvider implements RepositoryProvider {
  private apiClient?: GitHubApiClient;

  constructor(apiClient?: GitHubApiClient) {
    this.apiClient = apiClient;
  }

  async acquire(
    owner: string,
    repo: string,
    options?: string | AcquireOptions,
  ): Promise<AcquiredRepository> {
    const opts: AcquireOptions =
      typeof options === "string" ? { authToken: options } : options || {};
    const client =
      opts.apiClient || this.apiClient || new GitHubApiClient({ authToken: opts.authToken });

    // 1. Fetch Repository Metadata via dedicated API Client
    const repoData = await client.getRepository(owner, repo);
    const defaultBranch = repoData.default_branch || "main";
    const repoUrl = repoData.html_url || `https://github.com/${owner}/${repo}`;
    const githubId = repoData.id ? BigInt(repoData.id) : null;

    // Target revision (branch, tag, or commit SHA; defaults to default_branch)
    const targetRevision = opts.revision || defaultBranch;

    // 2. Fetch HEAD Commit SHA for requested revision
    let headCommitSha: string | null = null;
    try {
      const commitData = await client.getCommit(owner, repo, targetRevision);
      headCommitSha = commitData.sha || null;
    } catch {
      // Non-fatal: HEAD SHA is best-effort
    }

    const metadata: RepositoryMetadata = {
      githubId,
      name: repoData.name || repo,
      owner: repoData.owner?.login || owner,
      url: repoUrl,
      defaultBranch,
      description: repoData.description || null,
      primaryLanguage: repoData.language || null,
      headCommitSha,
      revision: targetRevision,
      isPrivate: Boolean(repoData.private),
    };

    // 3. Create Unique Temporary Workspace
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "repo-ingest-"));

    try {
      // 4. Download Tarball Stream directly into tar.x() — no full-archive buffer
      const archiveRes = await client.downloadArchiveStream(owner, repo, targetRevision);

      const extractDir = path.join(tempDir, "extracted");
      await fs.promises.mkdir(extractDir, { recursive: true });

      // Stream response body directly to tar extractor — avoids loading full archive into memory
      await pipeline(
        Readable.fromWeb(archiveRes.body as import("stream/web").ReadableStream),
        tar.x({ cwd: extractDir }),
      );

      // GitHub tarballs extract into a single inner folder like `owner-repo-sha`
      const extractedEntries = await fs.promises.readdir(extractDir, { withFileTypes: true });
      const rootDirEntry = extractedEntries.find((entry) => entry.isDirectory());
      const workspacePath = rootDirEntry ? path.join(extractDir, rootDirEntry.name) : extractDir;

      const cleanup = async () => {
        try {
          await fs.promises.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      };

      return { metadata, workspacePath, cleanup };
    } catch (error) {
      // Clean up temp dir on any failure before re-throwing
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
      throw new Error(
        `Failed to acquire repository archive for ${owner}/${repo}@${targetRevision}: ${(error as Error).message}`,
        { cause: error },
      );
    }
  }
}
