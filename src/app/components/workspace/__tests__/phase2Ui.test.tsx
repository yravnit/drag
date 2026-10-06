import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanUsageModal } from "../PlanUsageModal";
import { ModelSelector } from "../ModelSelector";
import { RepoList } from "../RepoList";
import { AddRepoModal } from "../AddRepoModal";
import type { PlanUsageData, WorkspaceRepository } from "../types";

describe("Phase 2 UI Components", () => {
  const samplePlanUsage: PlanUsageData = {
    plan: "free",
    pricing: {
      amount: "0",
      cadence: "forever",
      currency: "INR",
      displayPrice: "₹0",
      description: "Free plan for personal experimentation",
    },
    entitlements: {
      plan: "free",
      repositoryLimit: 2,
      monthlyQueryLimit: 25,
      repositorySizeLimitBytes: 50 * 1024 * 1024,
      fileLimit: 2500,
      allowedBranch: "main",
      incrementalReindexAllowed: false,
    },
    usage: {
      repositoriesCount: 1,
      monthlyQueriesCount: 12,
      monthlyQueriesResetAt: Date.now() + 86400000,
    },
  };

  describe("1. Plan UI & Pricing display (PlanUsageModal)", () => {
    it("displays Free, Hobby, and Enterprise pricing tiers accurately", () => {
      const html = renderToStaticMarkup(
        <PlanUsageModal
          isOpen={true}
          onClose={vi.fn()}
          planUsage={samplePlanUsage}
        />,
      );

      // Free tier
      expect(html).toContain("Free");
      expect(html).toContain("₹0");

      // Hobby tier
      expect(html).toContain("Hobby");
      expect(html).toContain("₹499");
      expect(html).toContain("/month");

      // Enterprise tier
      expect(html).toContain("Enterprise");
      expect(html).not.toContain("Starting from");
      expect(html).toContain("₹15,000*");
      expect(html).toContain("*Contact sales for custom pricing");
    });

    it("clearly indicates the user's current plan and active status", () => {
      const html = renderToStaticMarkup(
        <PlanUsageModal
          isOpen={true}
          onClose={vi.fn()}
          planUsage={samplePlanUsage}
        />,
      );

      expect(html).toContain("Current");
      expect(html).toContain("Active Plan");
    });

    it("displays usage counters from backend entitlement API without frontend constants", () => {
      const html = renderToStaticMarkup(
        <PlanUsageModal
          isOpen={true}
          onClose={vi.fn()}
          planUsage={samplePlanUsage}
        />,
      );

      // Repositories: 1 / 2
      expect(html).toContain("Repositories");
      expect(html).toContain("1");
      expect(html).toContain("/ 2");

      // RAG queries: 12 / 25 this month
      expect(html).toContain("RAG queries");
      expect(html).toContain("12");
      expect(html).toContain("/ 25 this month");
    });

    it("renders upgrade button to Hobby for Free users", () => {
      const html = renderToStaticMarkup(
        <PlanUsageModal
          isOpen={true}
          onClose={vi.fn()}
          planUsage={samplePlanUsage}
        />,
      );

      expect(html).toContain("Upgrade to Hobby");
    });
  });

  describe("2. Repository Privacy Indicator (RepoList)", () => {
    it("renders server-provided privacy indicator for public repositories", () => {
      const repos: WorkspaceRepository[] = [
        {
          id: "repo-pub",
          githubId: "1001",
          name: "public-drag",
          owner: "test-user",
          url: "https://github.com/test-user/public-drag",
          defaultBranch: "main",
          description: "Public project",
          primaryLanguage: "TypeScript",
          indexedAt: new Date().toISOString(),
          embeddingStatus: "ready",
          createdAt: new Date().toISOString(),
          isPrivate: false,
          privacyLabel: "Public repo",
          embeddingLabel: "Gemini embeddings",
        },
      ];

      const html = renderToStaticMarkup(
        <RepoList
          repositories={repos}
          selectedRepo={null}
          onSelectRepo={vi.fn()}
          onDeleteRepo={vi.fn()}
          onRetryRepo={vi.fn()}
          onOpenAddModal={vi.fn()}
        />,
      );

      expect(html).toContain("Public repo");
      expect(html).not.toContain("Gemini embeddings");
    });

    it("renders server-provided privacy indicator for private repositories", () => {
      const repos: WorkspaceRepository[] = [
        {
          id: "repo-priv",
          githubId: "1002",
          name: "private-drag",
          owner: "test-user",
          url: "https://github.com/test-user/private-drag",
          defaultBranch: "main",
          description: "Private project",
          primaryLanguage: "TypeScript",
          indexedAt: new Date().toISOString(),
          embeddingStatus: "ready",
          createdAt: new Date().toISOString(),
          isPrivate: true,
          privacyLabel: "Private repo",
          embeddingLabel: "Protected embeddings",
        },
      ];

      const html = renderToStaticMarkup(
        <RepoList
          repositories={repos}
          selectedRepo={null}
          onSelectRepo={vi.fn()}
          onDeleteRepo={vi.fn()}
          onRetryRepo={vi.fn()}
          onOpenAddModal={vi.fn()}
        />,
      );

      expect(html).toContain("Private repo");
      expect(html).not.toContain("Protected embeddings");
    });
  });

  describe("3. Repository Policy Limits & Clean Add Modal (AddRepoModal)", () => {
    it("surfaces applicable plan limits derived dynamically from backend entitlements", () => {
      const html = renderToStaticMarkup(
        <AddRepoModal
          isOpen={true}
          onClose={vi.fn()}
          onAddRepo={vi.fn()}
          githubRepos={[]}
          githubLoading={false}
          onLoadMoreGithub={vi.fn()}
          repoAddLoading={false}
          repoAddError=""
          entitlements={samplePlanUsage.entitlements}
        />,
      );

      expect(html).toContain("50 MB maximum");
      expect(html).toContain("2,500 files maximum");
      expect(html).toContain("main branch only");
      expect(html).toContain("incremental reindexing unavailable");
    });

    it("does not render verbose privacy disclosures at repository indexing point", () => {
      const html = renderToStaticMarkup(
        <AddRepoModal
          isOpen={true}
          onClose={vi.fn()}
          onAddRepo={vi.fn()}
          githubRepos={[]}
          githubLoading={false}
          onLoadMoreGithub={vi.fn()}
          repoAddLoading={false}
          repoAddError=""
          entitlements={samplePlanUsage.entitlements}
        />,
      );

      expect(html).not.toContain("Privacy disclosures");
      expect(html).not.toContain("Public repository code may be used by third-party services to improve their products.");
      expect(html).not.toContain("Private repo chats don't expose your code to public-repository AI providers.");
    });

    it("renders clean repository limit message when limit is reached", () => {
      const limitMessage = "Repository limit reached.\nUpgrade to Hobby to add more repositories.";
      const html = renderToStaticMarkup(
        <AddRepoModal
          isOpen={true}
          onClose={vi.fn()}
          onAddRepo={vi.fn()}
          githubRepos={[]}
          githubLoading={false}
          onLoadMoreGithub={vi.fn()}
          repoAddLoading={false}
          repoAddError={limitMessage}
          entitlements={samplePlanUsage.entitlements}
        />,
      );

      expect(html).toContain("Repository limit reached.");
      expect(html).toContain("Upgrade to Hobby to add more repositories.");
    });
  });

  describe("4. ModelSelector Component & Provider Integration", () => {
    it("renders default model selection and retains non-NVIDIA provider functionality", () => {
      const html = renderToStaticMarkup(
        <ModelSelector
          selectedModel="default"
          onSelectModel={vi.fn()}
          defaultModelName="Default (minimax-m3)"
        />,
      );

      expect(html).toContain("Default (minimax-m3)");
    });
  });
});
