import { db } from "@/db/db";
import { userRepositories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserEntitlements } from "@/lib/plans/entitlements";
import { start } from "workflow/api";
import { ingestRepository } from "@/workflows/ingest";
import { GitHubApiClient } from "@/lib/ingestion/githubApiClient";
import { serverEnv } from "@/data/serverEnv";
import { claimSyncBatch, settleSyncLease } from "@/lib/leases/repositoryLeases";

export { claimSyncBatch, settleSyncLease };

export interface SyncPayload {
  batchSize?: number;
}

export interface SyncResult {
  success: boolean;
  checkedCount: number;
  triggeredCount: number;
  skippedCount: number;
  errorsCount: number;
}

const DEFAULT_BATCH_SIZE = 5;

async function claimSyncBatchStep(batchSize: number) {
  "use step";
  return claimSyncBatch(db, batchSize);
}

async function checkAndTriggerStep(repo: { id: string; owner: string; name: string; defaultBranch: string; headCommitSha: string | null }): Promise<{ triggered: boolean; error?: string }> {
  "use step";

  let triggered = false;
  let errorMsg: string | undefined;

  try {
    // Repositories are shared across users. Check every association and allow the sync when at
    // least one associated user is entitled; picking one arbitrary user would stall the
    // repository for its Hobby/Enterprise users whenever a Free user happens to be selected.
    const assocs = await db
      .select({ userId: userRepositories.userId })
      .from(userRepositories)
      .where(eq(userRepositories.repositoryId, repo.id));

    let entitledUserId: string | null = null;
    for (const assoc of assocs) {
      const entitlements = await getUserEntitlements(db, assoc.userId);
      if (entitlements.incrementalReindexAllowed) {
        entitledUserId = assoc.userId;
        break;
      }
    }

    if (assocs.length > 0 && !entitledUserId) {
      await settleSyncLease(db, repo.id);
      return { triggered: false };
    }

    const apiClient = new GitHubApiClient({ authToken: serverEnv.GITHUB_TOKEN });
    const latestCommit = await apiClient.getCommit(
      repo.owner,
      repo.name,
      repo.defaultBranch || "main",
    );
    const latestSha = latestCommit.sha;

    if (latestSha && (!repo.headCommitSha || repo.headCommitSha !== latestSha)) {
      // Trigger ingest
      await start(ingestRepository, [{
        owner: repo.owner,
        repo: repo.name,
        revision: repo.defaultBranch,
        userId: entitledUserId ?? undefined,
      }]);
      triggered = true;
    }
  } catch (err) {
    console.error(`Error checking repo ${repo.owner}/${repo.name}:`, err);
    errorMsg = err instanceof Error && err.message ? err.message : "Unknown error";
  }

  // Release lease
  await settleSyncLease(db, repo.id);

  return { triggered, error: errorMsg };
}

export async function syncRepositories(payload: SyncPayload): Promise<SyncResult> {
  "use workflow";

  const batchSize = payload.batchSize || DEFAULT_BATCH_SIZE;
  
  const claimedRepos = await claimSyncBatchStep(batchSize);
  
  if (claimedRepos.length === 0) {
    return {
      success: true,
      checkedCount: 0,
      triggeredCount: 0,
      skippedCount: 0,
      errorsCount: 0,
    };
  }

  let triggeredCount = 0;
  let skippedCount = 0;
  let errorsCount = 0;

  for (const repo of claimedRepos) {
    const result = await checkAndTriggerStep(repo);
    if (result.error) {
      errorsCount++;
    } else if (result.triggered) {
      triggeredCount++;
    } else {
      skippedCount++;
    }
  }

  return {
    success: true,
    checkedCount: claimedRepos.length,
    triggeredCount,
    skippedCount,
    errorsCount,
  };
}
