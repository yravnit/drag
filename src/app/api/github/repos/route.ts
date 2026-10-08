import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { db } from "@/db/db";
import { getUserAccessMode } from "@/lib/auth/accessMode";

/** Minimal shape of a repository item returned by GitHub's list-repos endpoint. */
interface GitHubRepoListItem {
  id: number;
  name: string;
  owner: { login: string };
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  default_branch?: string;
  updated_at: string;
}

/**
 * GET /api/github/repos
 * Lists personal and organization repositories of the authenticated user from GitHub.
 * Query parameters:
 *  - page (default: 1)
 *  - per_page (default: 30)
 */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const perPage = parseInt(searchParams.get("per_page") || "30", 10);

    const tokenRes = await auth.api.getAccessToken({
      body: { providerId: "github" },
      headers: request.headers,
    });

    const userToken = tokenRes?.accessToken;
    if (!userToken) {
      return NextResponse.json({ error: "No GitHub credentials found" }, { status: 403 });
    }

    // Call GitHub API to list repos for the authenticated user (includes own + orgs repos)
    // sort=updated ensures recently active repositories appear first.
    const url = `https://api.github.com/user/repos?page=${page}&per_page=${perPage}&sort=updated`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Vercel-Workflow-Ingestion-Engine",
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json(
        { error: `GitHub API error: ${res.status} - ${errBody}` },
        { status: res.status }
      );
    }

    const data = (await res.json()) as GitHubRepoListItem[];

    const accessMode = await getUserAccessMode(db, session.user.id);

    // Map response to a minimal clean JSON structure
    const repos = data.map((repo) => ({
      githubId: repo.id.toString(),
      name: repo.name,
      owner: repo.owner.login,
      fullName: repo.full_name,
      url: repo.html_url,
      description: repo.description,
      private: repo.private,
      defaultBranch: repo.default_branch || "main",
      updatedAt: repo.updated_at,
      requiresUpgrade: repo.private && accessMode === "public",
    }));

    return NextResponse.json(repos, {
      headers: {
        "X-Access-Mode": accessMode,
      },
    });
  } catch (error) {
    console.error("[GET /api/github/repos] Error:", error);
    return NextResponse.json({ error: "Failed to fetch GitHub repositories" }, { status: 500 });
  }
}
