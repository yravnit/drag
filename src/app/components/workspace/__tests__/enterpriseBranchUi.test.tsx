import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AddRepoModal } from "../AddRepoModal";
import { PlanUsageModal } from "../PlanUsageModal";
import type { PlanUsageData } from "../types";

describe("Branch Selection UI and BOSS Plan", () => {
  const freeEntitlements: PlanUsageData["entitlements"] = {
    plan: "free",
    repositoryLimit: 2,
    monthlyQueryLimit: 25,
    repositorySizeLimitBytes: 50 * 1024 * 1024,
    fileLimit: 2500,
    allowedBranch: "main",
    incrementalReindexAllowed: false,
  };

  const hobbyEntitlements: PlanUsageData["entitlements"] = {
    plan: "hobby",
    repositoryLimit: 10,
    monthlyQueryLimit: 500,
    repositorySizeLimitBytes: 250 * 1024 * 1024,
    fileLimit: 12500,
    allowedBranch: "*",
    incrementalReindexAllowed: true,
  };

  const enterpriseDefaultEntitlements: PlanUsageData["entitlements"] = {
    plan: "enterprise",
    repositoryLimit: 50,
    monthlyQueryLimit: null,
    repositorySizeLimitBytes: 1024 * 1024 * 1024,
    fileLimit: 50000,
    allowedBranch: "main",
    incrementalReindexAllowed: true,
  };

  const enterpriseCustomEntitlements: PlanUsageData["entitlements"] = {
    plan: "enterprise",
    repositoryLimit: 100,
    monthlyQueryLimit: null,
    repositorySizeLimitBytes: 2 * 1024 * 1024 * 1024,
    fileLimit: 100000,
    allowedBranch: "develop",
    incrementalReindexAllowed: true,
  };

  const enterpriseWildcardEntitlements: PlanUsageData["entitlements"] = {
    plan: "enterprise",
    repositoryLimit: 100,
    monthlyQueryLimit: null,
    repositorySizeLimitBytes: 2 * 1024 * 1024 * 1024,
    fileLimit: 100000,
    allowedBranch: "*",
    incrementalReindexAllowed: true,
  };

  const bossEntitlements: PlanUsageData["entitlements"] = {
    plan: "boss",
    repositoryLimit: Number.MAX_SAFE_INTEGER,
    monthlyQueryLimit: null,
    repositorySizeLimitBytes: Number.MAX_SAFE_INTEGER,
    fileLimit: Number.MAX_SAFE_INTEGER,
    allowedBranch: "*",
    incrementalReindexAllowed: true,
  };

  describe("AddRepoModal Branch Selection", () => {
    it("disables branch input for Free plan users", () => {
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
          entitlements={freeEntitlements}
        />,
      );

      expect(html).toContain("repo-branch-input");
      expect(html).toContain("main branch only on Free plan");
      expect(html).toContain("disabled=\"\"");
    });

    it("enables branch input for Hobby plan users", () => {
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
          entitlements={hobbyEntitlements}
        />,
      );

      expect(html).toContain("repo-branch-input");
      expect(html).toContain("Any branch");
      expect(html).not.toContain("main branch only on Free plan");
    });

    it("renders branch input for Enterprise users with safe default main", () => {
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
          entitlements={enterpriseDefaultEntitlements}
        />,
      );

      expect(html).toContain("repo-branch-input");
      expect(html).toContain("placeholder=\"main\"");
    });

    it("renders branch input for Enterprise users with configured entitlement branch", () => {
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
          entitlements={enterpriseCustomEntitlements}
        />,
      );

      expect(html).toContain("repo-branch-input");
      expect(html).toContain("develop branch entitlement");
    });

    it("renders branch input for Enterprise users with wildcard * allowed", () => {
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
          entitlements={enterpriseWildcardEntitlements}
        />,
      );

      expect(html).toContain("repo-branch-input");
      expect(html).toContain("Any branch");
    });

    it("renders branch input and hides repository policy limits for BOSS plan users", () => {
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
          entitlements={bossEntitlements}
        />,
      );

      expect(html).toContain("repo-branch-input");
      expect(html).toContain("Any branch");
      expect(html).not.toContain("Repository Policy (boss plan)");
    });
  });

  describe("PlanUsageModal BOSS Plan View", () => {
    it("renders BOSS mode active banner without sparkles icon when currentPlan is boss", () => {
      const bossPlanUsage: PlanUsageData = {
        plan: "boss",
        pricing: {
          amount: "0",
          cadence: "forever",
          currency: "INR",
          displayPrice: "Infinite",
          description: "Exclusive infinite administrator plan",
        },
        entitlements: bossEntitlements,
        usage: {
          repositoriesCount: 5,
          monthlyQueriesCount: 88,
          monthlyQueriesResetAt: Date.now() + 86400000,
        },
      };

      const html = renderToStaticMarkup(
        <PlanUsageModal
          isOpen={true}
          onClose={vi.fn()}
          planUsage={bossPlanUsage}
        />,
      );

      expect(html).toContain("BOSS Mode Active");
      expect(html).toContain("Infinite repositories");
      expect(html).toContain("Reserved exclusively for the workspace administrator");
      // PII must never ship in the client bundle
      expect(html).not.toContain("yrovnit47@gmail.com");
    });
  });
});
