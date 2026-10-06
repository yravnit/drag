import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const owner = searchParams.get("owner");
    const repo = searchParams.get("repo");

    if (!owner || !repo) {
      return NextResponse.json(
        { error: "Missing required query parameters: owner and repo" },
        { status: 400 },
      );
    }

    const tokenRes = await auth.api.getAccessToken({
      body: { providerId: "github" },
      headers: request.headers,
    });

    const userToken = tokenRes?.accessToken;
    if (!userToken) {
      return NextResponse.json({ error: "No GitHub credentials found" }, { status: 403 });
    }

    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${userToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Vercel-Workflow-Ingestion-Engine",
        },
      },
    );

    if (!res.ok) {
      return NextResponse.json(
        { error: `GitHub API error: ${res.statusText}` },
        { status: res.status },
      );
    }

    const branches = (await res.json()) as Array<{ name: string }>;
    return NextResponse.json({
      branches: Array.isArray(branches) ? branches.map((b) => b.name) : [],
    });
  } catch (err) {
    console.error("[GET /api/github/branches] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch branches" },
      { status: 500 },
    );
  }
}
