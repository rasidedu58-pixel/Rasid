import { z } from "zod";

/**
 * Identity/Me/Onboarding contract types — API Contract v1.0 §9.1, §11.1,
 * §11.2. Shared between apps/api (response producer) and apps/web
 * (response consumer). Types only — no business logic.
 */

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    fullName: z.string(),
  }),
  workspaces: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      roleLabel: z.string(),
      status: z.enum(["INVITED", "ACTIVE", "DISABLED"]),
    }),
  ),
  // Platform (company-internal) staff status — lets the app conditionally show
  // an "إدارة راصد" entry. Read-only signal; the real authorization boundary is
  // still the server-side PlatformAdminGuard on every /platform-admin call.
  platform: z.object({ isStaff: z.boolean() }),
});

export type MeResponse = z.infer<typeof meResponseSchema>;

export const workspaceContextResponseSchema = z.object({
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
    timezone: z.string(),
  }),
  membership: z.object({
    id: z.string().uuid(),
    roleLabel: z.string(),
  }),
  // `permissions`: the caller's real effective permission keys (Phase 11 —
  // backed by PermissionResolverService, same resolver every write
  // endpoint's PermissionGuard uses). `entitlements`: allowed capability
  // keys for the workspace's current subscription (Phase 8).
  permissions: z.array(z.string()),
  entitlements: z.array(z.string()),
  subscriptionState: z.string().nullable(),
});

export type WorkspaceContextResponse = z.infer<typeof workspaceContextResponseSchema>;

export const dueDatePolicySchema = z.enum(["UNIFIED", "PER_GROUP"]);
export type DueDatePolicy = z.infer<typeof dueDatePolicySchema>;

/**
 * Domain validation rule shared by apps/api and apps/web: `unifiedDueDay`
 * is required (1..28) only when dueDatePolicy = UNIFIED, and forbidden
 * otherwise.
 */
export const onboardingCompleteRequestSchema = z
  .object({
    displayName: z.string().trim().min(1),
    subjects: z.array(z.string()).optional(),
    dueDatePolicy: dueDatePolicySchema,
    unifiedDueDay: z.number().int().min(1).max(28).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dueDatePolicy === "UNIFIED" && value.unifiedDueDay === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unifiedDueDay"],
        message: "unifiedDueDay is required when dueDatePolicy is UNIFIED.",
      });
    }
    if (value.dueDatePolicy === "PER_GROUP" && value.unifiedDueDay !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["unifiedDueDay"],
        message: "unifiedDueDay must not be set when dueDatePolicy is PER_GROUP.",
      });
    }
  });

export type OnboardingCompleteRequest = z.infer<typeof onboardingCompleteRequestSchema>;

export const onboardingCompleteResponseSchema = z.object({
  workspace: z.object({
    id: z.string().uuid(),
    name: z.string(),
    dueDatePolicy: dueDatePolicySchema,
    unifiedDueDay: z.number().int().min(1).max(28).nullable(),
  }),
});

export type OnboardingCompleteResponse = z.infer<typeof onboardingCompleteResponseSchema>;
