import { serverEnv } from "@/data/serverEnv";

export type PlanType = "free" | "hobby" | "enterprise" | "boss";

export interface PlanPricing {
  amount: string;
  cadence: string;
  currency: string;
  displayPrice: string;
  description: string;
}

export const PLAN_PRICING: Record<PlanType, PlanPricing> = {
  free: {
    amount: "0",
    cadence: "forever",
    currency: "INR",
    displayPrice: "₹0",
    description: "Free plan for personal experimentation",
  },
  hobby: {
    amount: "499",
    cadence: "/month",
    currency: "INR",
    displayPrice: "₹499/month",
    description: "Hobby plan for active developers",
  },
  enterprise: {
    amount: "15000",
    cadence: "/month",
    currency: "INR",
    displayPrice: "Starting from ₹15,000/month",
    description: "Contact sales for custom pricing",
  },
  boss: {
    amount: "0",
    cadence: "forever",
    currency: "INR",
    displayPrice: "Infinite",
    description: "Special unlimited plan exclusively for administrator",
  },
};

export interface PlanEntitlements {
  plan: PlanType;
  repositoryLimit: number;
  monthlyQueryLimit: number | null; // null represents unmetered / configurable
  repositorySizeLimitBytes: number;
  fileLimit: number;
  allowedBranch: string;
  incrementalReindexAllowed: boolean;
}

export const FREE_PLAN_LIMITS: Readonly<PlanEntitlements> = {
  plan: "free",
  repositoryLimit: 2,
  monthlyQueryLimit: 25,
  repositorySizeLimitBytes: 50 * 1024 * 1024, // 50 MB
  fileLimit: 2500,
  allowedBranch: "main",
  incrementalReindexAllowed: false,
};

export const HOBBY_PLAN_LIMITS: Readonly<PlanEntitlements> = {
  plan: "hobby",
  repositoryLimit: 10,
  monthlyQueryLimit: serverEnv.HOBBY_MONTHLY_QUERY_LIMIT,
  repositorySizeLimitBytes: 250 * 1024 * 1024, // 250 MB
  fileLimit: 12500,
  allowedBranch: "*",
  incrementalReindexAllowed: true,
};

/**
 * Enterprise baseline defaults. Configurable per enterprise user/organization.
 */
export const ENTERPRISE_DEFAULT_LIMITS: Readonly<PlanEntitlements> = {
  plan: "enterprise",
  repositoryLimit: 50,
  monthlyQueryLimit: null,
  repositorySizeLimitBytes: 1024 * 1024 * 1024, // 1 GB
  fileLimit: 50000,
  allowedBranch: "main",
  incrementalReindexAllowed: true,
};

// ponytail: BOSS plan uses Number.MAX_SAFE_INTEGER for infinite limits; upgrade path is database-driven tier flags.
export const BOSS_PLAN_LIMITS: Readonly<PlanEntitlements> = {
  plan: "boss",
  repositoryLimit: Number.MAX_SAFE_INTEGER,
  monthlyQueryLimit: null,
  repositorySizeLimitBytes: Number.MAX_SAFE_INTEGER,
  fileLimit: Number.MAX_SAFE_INTEGER,
  allowedBranch: "*",
  incrementalReindexAllowed: true,
};

export function getDefaultEntitlementsForPlan(
  plan: PlanType,
  hobbyMonthlyLimit?: number | null,
): PlanEntitlements {
  switch (plan) {
    case "free":
      return { ...FREE_PLAN_LIMITS };
    case "hobby":
      return {
        ...HOBBY_PLAN_LIMITS,
        monthlyQueryLimit:
          hobbyMonthlyLimit !== undefined
            ? hobbyMonthlyLimit
            : serverEnv.HOBBY_MONTHLY_QUERY_LIMIT,
      };
    case "enterprise":
      return { ...ENTERPRISE_DEFAULT_LIMITS };
    case "boss":
      return { ...BOSS_PLAN_LIMITS };
    default:
      return { ...FREE_PLAN_LIMITS };
  }
}
