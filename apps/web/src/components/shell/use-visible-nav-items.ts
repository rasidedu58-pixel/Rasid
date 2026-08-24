import { useWorkspace } from "../../lib/workspace-provider";
import { NAV_ITEMS, type NavItem } from "./nav-config";

export function useVisibleNavItems(): NavItem[] {
  const { hasPermission, isOwner } = useWorkspace();
  return NAV_ITEMS.filter((item) => {
    if (item.ownerOnly && !isOwner) return false;
    if (item.anyOf && !item.anyOf.some((p) => hasPermission(p))) return false;
    return true;
  });
}
