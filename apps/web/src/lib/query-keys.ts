/**
 * Central query key factory — every hook builds its key from here so
 * invalidation after a mutation is a deliberate, typed call
 * (`queryClient.invalidateQueries({queryKey: qk.students.list(ws)})`)
 * instead of a magic string repeated in N places.
 */
export const qk = {
  me: () => ["me"] as const,
  workspaceContext: (workspaceId: string) => ["workspace-context", workspaceId] as const,

  students: {
    list: (ws: string, params?: Record<string, unknown>) => ["students", ws, "list", params] as const,
    detail: (ws: string, id: string) => ["students", ws, "detail", id] as const,
    obligations: (ws: string, id: string) => ["students", ws, id, "obligations"] as const,
  },
  groups: {
    list: (ws: string) => ["groups", ws, "list"] as const,
    detail: (ws: string, id: string) => ["groups", ws, "detail", id] as const,
    month: (ws: string, groupMonthId: string) => ["group-months", ws, groupMonthId] as const,
    schedule: (ws: string, groupMonthId: string) => ["group-months", ws, groupMonthId, "schedule"] as const,
  },
  months: {
    list: (ws: string) => ["months", ws, "list"] as const,
    detail: (ws: string, id: string) => ["months", ws, "detail", id] as const,
    groupMonths: (ws: string, id: string) => ["months", ws, id, "group-months"] as const,
  },
  sessions: {
    list: (ws: string, params?: Record<string, unknown>) => ["sessions", ws, "list", params] as const,
    detail: (ws: string, id: string) => ["sessions", ws, "detail", id] as const,
    roster: (ws: string, id: string) => ["sessions", ws, id, "roster"] as const,
    review: (ws: string, id: string) => ["sessions", ws, id, "review"] as const,
  },
  finance: {
    collectionQueue: (ws: string) => ["finance", ws, "collection-queue"] as const,
    summary: (ws: string) => ["finance", ws, "summary"] as const,
  },
  attention: {
    cases: (ws: string, params?: Record<string, unknown>) => ["attention-cases", ws, "list", params] as const,
    case: (ws: string, id: string) => ["attention-cases", ws, "detail", id] as const,
    followups: (ws: string, params?: Record<string, unknown>) => ["followups", ws, "list", params] as const,
  },
  team: {
    list: (ws: string) => ["team", ws, "list"] as const,
  },
  billing: {
    subscription: (ws: string) => ["billing", ws, "subscription"] as const,
    entitlements: (ws: string) => ["entitlements", ws, "list"] as const,
  },
  reports: {
    student: (ws: string, id: string) => ["reports", ws, "student", id] as const,
    group: (ws: string, id: string) => ["reports", ws, "group", id] as const,
    monthly: (ws: string, monthId: string) => ["reports", ws, "monthly", monthId] as const,
    export: (ws: string, exportId: string) => ["exports", ws, exportId] as const,
  },
  notifications: {
    list: (ws: string) => ["notifications", ws, "list"] as const,
  },
  actionCenter: {
    root: (ws: string) => ["action-center", ws] as const,
  },
  platformAdmin: {
    dashboard: () => ["platform-admin", "dashboard"] as const,
    users: (params?: Record<string, unknown>) => ["platform-admin", "users", params] as const,
    user: (id: string) => ["platform-admin", "users", "detail", id] as const,
    workspaces: (params?: Record<string, unknown>) => ["platform-admin", "workspaces", params] as const,
    workspace: (id: string) => ["platform-admin", "workspaces", "detail", id] as const,
    subscriptions: (params?: Record<string, unknown>) => ["platform-admin", "subscriptions", params] as const,
  },
} as const;
