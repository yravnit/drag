import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { repositories, chunks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  assertRepositoryAssociation,
  verifyRepositoryAccess,
} from "@/lib/access/repositoryAccess";
import { isSensitiveFile } from "@/lib/ingestion/fileFilter";

export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const params = await props.params;
    const { id: repoId } = params;

    // 1. Authenticate user
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // 2. Verify repository association in PostgreSQL
    const associated = await assertRepositoryAssociation(db, userId, repoId);
    if (!associated) {
      return NextResponse.json({ error: "Forbidden: Not associated with repository" }, { status: 403 });
    }

    // 3. Find repository record
    const [repo] = await db
      .select({
        id: repositories.id,
        owner: repositories.owner,
        name: repositories.name,
        defaultBranch: repositories.defaultBranch,
        headCommitSha: repositories.headCommitSha,
        isPrivate: repositories.isPrivate,
      })
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);

    if (!repo) {
      return NextResponse.json({ error: "Repository not found" }, { status: 404 });
    }

    // 4. Verify GitHub access rights
    const { hasAccess } = await verifyRepositoryAccess(
      db,
      { userId, repositoryId: repo.id, owner: repo.owner, name: repo.name },
      {
        getGithubToken: () =>
          auth.api
            .getAccessToken({
              body: { providerId: "github" },
              headers: request.headers,
            })
            .then((r) => r?.accessToken ?? null),
      },
    );

    if (!hasAccess) {
      return NextResponse.json(
        { error: "Forbidden: You do not have access to this repository on GitHub" },
        { status: 403 },
      );
    }

    // 5. Validate filePath parameter
    const url = new URL(request.url);
    const rawPath = url.searchParams.get("path");
    if (!rawPath || typeof rawPath !== "string") {
      return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
    }

    const normalizedPath = rawPath.replace(/\\/g, "/").trim();

    // Prevent directory traversal and malicious paths
    if (
      normalizedPath.startsWith("/") ||
      normalizedPath.includes("..") ||
      normalizedPath.includes("\0") ||
      /^[a-zA-Z]:/.test(normalizedPath)
    ) {
      return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
    }

    // Block sensitive or secret files (.env, private keys, certificates)
    if (isSensitiveFile(normalizedPath)) {
      return NextResponse.json({ error: "Access to sensitive file is restricted" }, { status: 403 });
    }

    let fileContent: string | null = null;

    // 6. Try fetching from GitHub API using user token
    const token = await auth.api
      .getAccessToken({
        body: { providerId: "github" },
        headers: request.headers,
      })
      .then((r) => r?.accessToken ?? null)
      .catch(() => null);

    const ref = repo.headCommitSha || repo.defaultBranch || "main";
    const githubApiUrl = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/${normalizedPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(ref)}`;

    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github.raw+json",
        "User-Agent": "DRAG-App",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const ghRes = await fetch(githubApiUrl, { headers });
      if (ghRes.ok) {
        fileContent = await ghRes.text();
      }
    } catch {
      // Fallback to database chunks if GitHub request fails
    }

    // 7. Fallback: Reconstruct from indexed database chunks if GitHub fetch unavailable
    if (fileContent === null) {
      try {
        const fileChunks = await db
          .select({
            text: chunks.text,
            startLine: chunks.startLine,
          })
          .from(chunks)
          .where(and(eq(chunks.repositoryId, repoId), eq(chunks.filePath, normalizedPath)))
          .orderBy(chunks.startLine);

        if (Array.isArray(fileChunks) && fileChunks.length > 0) {
          fileContent = fileChunks.map((c) => c.text).join("\n\n");
        }
      } catch {
        // DB chunk fallback failed
      }
    }

    if (fileContent === null) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const fileName = normalizedPath.split("/").pop() || "file.txt";

    return new Response(fileContent, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/repos/[id]/file] Error:", error);
    return NextResponse.json({ error: "Failed to retrieve file" }, { status: 500 });
  }
}
