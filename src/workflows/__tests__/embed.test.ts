import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSelect, mockUpdate, mockTransaction, mockGenerateEmbeddings } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockTransaction: vi.fn(),
  mockGenerateEmbeddings: vi.fn(),
}));

// Kept file-scoped: the `embedRepository` entrypoint tests rely on the module
// mock because the "use step" wrappers close over the singleton `db`.
vi.mock("@/db/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    transaction: mockTransaction,
  },
}));

vi.mock("@/db/schema", () => ({
  chunks: {
    id: "id-field",
    text: "text-field",
    repositoryId: "repositoryId-field",
    embedding: "embedding-field",
  },
  repositories: {
    id: "repositories-id-field",
    embeddingStatus: "repositories-embeddingStatus-field",
    embeddingLeaseExpiresAt: "repositories-embeddingLeaseExpiresAt-field",
    updatedAt: "repositories-updatedAt-field",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ field: a, value: b })),
  and: vi.fn((...args) => ({ and: args })),
  isNull: vi.fn((a) => ({ isNull: a })),
}));

vi.mock("@/lib/embeddings/router", () => ({
  getEmbeddingProviderForRepository: vi.fn(() => ({
    generateEmbeddings: mockGenerateEmbeddings,
    name: "gemini",
    model: "gemini-embedding-2",
    dimensions: 768,
  })),
  getDefaultEmbeddingMetadataForVisibility: vi.fn(() => ({
    embeddingProvider: "gemini",
    embeddingModel: "gemini-embedding-2",
    embeddingDimensions: 768,
  })),
}));

import { embedRepository, runEmbedBatch } from "../embed";
import { claimEmbeddingLease, finalizeEmbedding, clearEmbeddingLease } from "@/lib/leases/repositoryLeases";

/**
 * Helper to set up transaction mock for claimEmbeddingLeaseStep.
 * The step does: tx.select().from().where().for() to get the repo,
 * then tx.select().from().where().limit() to check pending chunks,
 * then tx.update().set().where() to set the lease.
 */
function setupClaimMock(opts: {
  repoFound?: boolean;
  alreadyProcessing?: boolean;
  hasPendingChunks?: boolean;
}) {
  const { repoFound = true, alreadyProcessing = false, hasPendingChunks = true } = opts;

  const repo = repoFound
    ? {
        id: "repo-123",
        embeddingStatus: alreadyProcessing ? "processing" : null,
        embeddingLeaseExpiresAt: alreadyProcessing ? new Date(Date.now() + 600_000) : null,
      }
    : undefined;

  mockTransaction.mockImplementation(async (fn) => {
    const txUpdateMock = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    let selectCallCount = 0;
    const txSelectMock = vi.fn().mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // First select: find the repo
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue(repo ? [repo] : []),
            }),
          }),
        };
      }
      // Second select: check for pending chunks
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(hasPendingChunks ? [{ id: "chunk-pending" }] : []),
          }),
        }),
      };
    });

    const tx = {
      select: txSelectMock,
      update: txUpdateMock,
    };
    return await fn(tx);
  });
}

/**
 * Helper to set up the finalizeEmbeddingStep mock (db.update directly, not in transaction).
 */
function setupFinalizeMock() {
  mockUpdate.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

describe("embedRepository workflow", () => {
  beforeEach(() => {
    mockSelect.mockReset();
    mockUpdate.mockReset();
    mockTransaction.mockReset();
    mockGenerateEmbeddings.mockReset();
  });

  it("throws an error if repositoryId is missing", async () => {
    await expect(embedRepository({ repositoryId: "" })).rejects.toThrow(
      'Missing required field: "repositoryId"'
    );
  });

  it("returns early if repo is already being processed (lease not expired)", async () => {
    setupClaimMock({ repoFound: true, alreadyProcessing: true });

    const result = await embedRepository({ repositoryId: "repo-123" });

    expect(result.success).toBe(true);
    expect(result.totalEmbedded).toBe(0);
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
  });

  it("returns early if no pending chunks exist", async () => {
    setupClaimMock({ repoFound: true, hasPendingChunks: false });
    setupFinalizeMock();

    const result = await embedRepository({ repositoryId: "repo-123" });

    expect(result.success).toBe(true);
    expect(result.totalEmbedded).toBe(0);
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
  });

  it("processes chunks in batches, calling provider and updating chunks in db", async () => {
    // The workflow calls db.transaction THREE times:
    // 1. claimEmbeddingLeaseStep (tx with select + update)
    // 2. runEmbedBatchStep inner transaction (tx with update only — persists embeddings)
    // We need separate mockImplementation for each.

    // Call 1: Claim step transaction
    const txSelectMock = vi.fn();
    let claimSelectCount = 0;
    txSelectMock.mockImplementation(() => {
      claimSelectCount++;
      if (claimSelectCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockResolvedValue([{
                id: "repo-123",
                embeddingStatus: null,
                embeddingLeaseExpiresAt: null,
              }]),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: "chunk-pending" }]),
          }),
        }),
      };
    });

    const txUpdateForClaim = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    // Call 2: Embed batch persist transaction
    const txUpdateForEmbed = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    mockTransaction
      .mockImplementationOnce(async (fn: any) => {
        return await fn({ select: txSelectMock, update: txUpdateForClaim });
      })
      .mockImplementationOnce(async (fn: any) => {
        return await fn({ update: txUpdateForEmbed });
      });

    // After the claim, the workflow calls runEmbedBatchStep which uses db.select directly.
    // 1st call returns 2 chunks, 2nd call returns repo metadata, 3rd call returns 0 chunks (breaking the loop)
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "chunk-1", text: "text 1" },
              { id: "chunk-2", text: "text 2" },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "repo-123", isPrivate: false, embeddingProvider: "gemini" },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

    mockGenerateEmbeddings.mockResolvedValue({
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
    });

    // finalizeEmbeddingStep uses db.update directly
    setupFinalizeMock();

    const result = await embedRepository({ repositoryId: "repo-123" });

    expect(result.success).toBe(true);
    expect(result.totalEmbedded).toBe(2);
    expect(mockGenerateEmbeddings).toHaveBeenCalledWith({ input: ["text 1", "text 2"], truncate: "END" });
  });

  it("throws an error if embedding count returned from API does not match chunk count", async () => {
    setupClaimMock({ repoFound: true, hasPendingChunks: true });
    setupFinalizeMock();

    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "chunk-1", text: "text 1" },
              { id: "chunk-2", text: "text 2" },
            ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              { id: "repo-123", isPrivate: false, embeddingProvider: "gemini" },
            ]),
          }),
        }),
      });

    mockGenerateEmbeddings.mockResolvedValue({
      embeddings: [[0.1, 0.2, 0.3]], // Return only 1 embedding instead of 2
    });

    await expect(embedRepository({ repositoryId: "repo-123" })).rejects.toThrow(
      "Mismatch between batch chunk size (2) and generated embeddings count (1)"
    );
  });
});

/**
 * Builds an injected stub db handle whose select chain resolves `rows`
 * and whose transaction runs the callback with a tx exposing only `update`.
 */
function setupBatchStub(rows: Array<{ id: string; text: string }>) {
  const selectLimit = vi.fn().mockResolvedValue(rows);
  const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });

  const updateSet = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
  const txUpdate = vi.fn().mockReturnValue({ set: updateSet });
  const transaction = vi.fn(async (fn: any) => fn({ update: txUpdate }));

  const stubDb = {
    select,
    update: vi.fn(),
    transaction,
  };

  return { stubDb, select, transaction, txUpdate, updateSet };
}

describe("runEmbedBatch (extracted function)", () => {
  beforeEach(() => {
    mockGenerateEmbeddings.mockReset();
  });

  it("returns zero counts without touching the provider when no pending chunks exist", async () => {
    const { stubDb } = setupBatchStub([]);

    const result = await runEmbedBatch(stubDb as any, "repo-123");

    expect(result).toEqual({ embeddedCount: 0, hasMore: false });
    expect(mockGenerateEmbeddings).not.toHaveBeenCalled();
    expect(stubDb.transaction).not.toHaveBeenCalled();
  });

  it("truncates oversized chunk texts to MAX_CHUNK_CHARS before calling the provider", async () => {
    const longText = "x".repeat(10_000);
    const { stubDb } = setupBatchStub([{ id: "chunk-1", text: longText }]);
    mockGenerateEmbeddings.mockResolvedValue({ embeddings: [[0.1]] });

    await runEmbedBatch(stubDb as any, "repo-123");

    expect(mockGenerateEmbeddings).toHaveBeenCalledTimes(1);
    const callArg = mockGenerateEmbeddings.mock.calls[0][0];
    expect(callArg.truncate).toBe("END");
    expect(callArg.input[0].length).toBe(8192);
  });

  it("persists embeddings sequentially inside a single transaction and reports batch stats", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      id: `chunk-${i}`,
      text: `text ${i}`,
    }));
    const { stubDb, transaction, txUpdate } = setupBatchStub(rows);
    mockGenerateEmbeddings.mockResolvedValue({
      embeddings: rows.map((_, i) => [i / 250, 1]),
    });

    const result = await runEmbedBatch(stubDb as any, "repo-123");

    expect(result).toEqual({ embeddedCount: 250, hasMore: true });
    expect(transaction).toHaveBeenCalledTimes(1);
    // 250 chunk updates + 1 repository record provenance update
    expect(txUpdate).toHaveBeenCalledTimes(251);
  });

  it("reports hasMore false for a partial final batch", async () => {
    const { stubDb } = setupBatchStub([
      { id: "chunk-1", text: "text 1" },
      { id: "chunk-2", text: "text 2" },
    ]);
    mockGenerateEmbeddings.mockResolvedValue({
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    });

    const result = await runEmbedBatch(stubDb as any, "repo-123");

    expect(result).toEqual({ embeddedCount: 2, hasMore: false });
  });

  it("throws when the provider returns a mismatched number of embeddings", async () => {
    const { stubDb } = setupBatchStub([
      { id: "chunk-1", text: "text 1" },
      { id: "chunk-2", text: "text 2" },
    ]);
    mockGenerateEmbeddings.mockResolvedValue({ embeddings: [[0.1, 0.2]] });

    await expect(runEmbedBatch(stubDb as any, "repo-123")).rejects.toThrow(
      "Mismatch between batch chunk size (2) and generated embeddings count (1)"
    );
  });
});

/**
 * Builds an injected stub db handle whose transaction exposes a tx with
 * select/update chains shaped like claimEmbeddingLease's usage.
 */
function setupClaimStub(opts: {
  repoFound?: boolean;
  alreadyProcessing?: boolean;
  hasPendingChunks?: boolean;
}) {
  const { repoFound = true, alreadyProcessing = false, hasPendingChunks = true } = opts;

  const repo = repoFound
    ? {
        id: "repo-123",
        embeddingStatus: alreadyProcessing ? "processing" : null,
        embeddingLeaseExpiresAt: alreadyProcessing ? new Date(Date.now() + 600_000) : null,
      }
    : undefined;

  const updateSet = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
  const txUpdate = vi.fn().mockReturnValue({ set: updateSet });

  let selectCallCount = 0;
  const txSelect = vi.fn().mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) {
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            for: vi.fn().mockResolvedValue(repo ? [repo] : []),
          }),
        }),
      };
    }
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(hasPendingChunks ? [{ id: "chunk-pending" }] : []),
        }),
      }),
    };
  });

  const transaction = vi.fn(async (fn: any) => fn({ select: txSelect, update: txUpdate }));
  const stubDb = {
    select: vi.fn(),
    update: vi.fn(),
    transaction,
  };

  return { stubDb, txSelect, txUpdate, updateSet };
}

describe("claimEmbeddingLease (extracted function)", () => {
  it("returns claimed false when the repository row does not exist", async () => {
    const { stubDb, txUpdate } = setupClaimStub({ repoFound: false });

    const result = await claimEmbeddingLease(stubDb as any, "repo-123");

    expect(result).toEqual({ claimed: false });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it("returns claimed false when another run holds an unexpired lease", async () => {
    const { stubDb, txUpdate } = setupClaimStub({ alreadyProcessing: true });

    const result = await claimEmbeddingLease(stubDb as any, "repo-123");

    expect(result).toEqual({ claimed: false });
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it("marks the repository ready when there are no pending chunks", async () => {
    const { stubDb, updateSet } = setupClaimStub({ hasPendingChunks: false });

    const result = await claimEmbeddingLease(stubDb as any, "repo-123");

    expect(result).toEqual({ claimed: false });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingStatus: "ready",
        embeddingLeaseExpiresAt: null,
      })
    );
  });

  it("claims the lease with a 10 minute expiry when pending chunks exist", async () => {
    const { stubDb, updateSet } = setupClaimStub({ hasPendingChunks: true });
    const before = Date.now();

    const result = await claimEmbeddingLease(stubDb as any, "repo-123");

    expect(result).toEqual({ claimed: true });
    expect(updateSet).toHaveBeenCalledTimes(1);
    const arg = updateSet.mock.calls[0][0];
    expect(arg.embeddingStatus).toBe("processing");
    const expiryMs = (arg.embeddingLeaseExpiresAt as Date).getTime();
    const tenMinutes = 10 * 60 * 1000;
    expect(expiryMs).toBeGreaterThanOrEqual(before + tenMinutes);
    expect(expiryMs).toBeLessThanOrEqual(Date.now() + tenMinutes);
  });
});

describe("finalizeEmbedding (extracted function)", () => {
  function setupFinalizeStub() {
    const updateSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    const update = vi.fn().mockReturnValue({ set: updateSet });
    const stubDb = { select: vi.fn(), update, transaction: vi.fn() };
    return { stubDb, update, updateSet };
  }

  it("sets the given status and clears the lease", async () => {
    const { stubDb, updateSet } = setupFinalizeStub();

    await finalizeEmbedding(stubDb as any, "repo-123", "ready");

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingStatus: "ready",
        embeddingLeaseExpiresAt: null,
      })
    );
    expect(updateSet.mock.calls[0][0].updatedAt).toBeInstanceOf(Date);
  });

  it("supports the failed status", async () => {
    const { stubDb, updateSet } = setupFinalizeStub();

    await finalizeEmbedding(stubDb as any, "repo-123", "failed");

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingStatus: "failed",
        embeddingLeaseExpiresAt: null,
      })
    );
  });
});

describe("clearEmbeddingLease", () => {
  it("clears embedding lease without marking ready so later run can continue", async () => {
    const updateSet = vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });
    const update = vi.fn().mockReturnValue({ set: updateSet });
    const stubDb = { select: vi.fn(), update, transaction: vi.fn() };

    await clearEmbeddingLease(stubDb as any, "repo-123");

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingStatus: "processing",
        embeddingLeaseExpiresAt: null,
      })
    );
    expect(updateSet.mock.calls[0][0].updatedAt).toBeInstanceOf(Date);
  });
});

