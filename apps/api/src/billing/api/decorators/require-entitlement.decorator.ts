import { SetMetadata } from "@nestjs/common";
import type { Capability } from "@academic-precision/database";

export const REQUIRED_ENTITLEMENT_METADATA_KEY = "requiredEntitlement";

/**
 * Route-level Entitlement gate — API Contract §5's authorization chain
 * places this AFTER Permission/Group Scope and BEFORE the Business Rule
 * itself: `Authenticated Identity → Membership → Permission → Group Scope
 * → Entitlement → Business Rule`. Independent of `@RequirePermission` —
 * neither substitutes for the other (Database Schema §10.2's own boxed
 * rule: "Entitlement يجيب: هل الـWorkspace يحق له capability؟ Permission
 * يجيب: هل هذا المستخدم يحق له الفعل؟ لا يتم دمج المفهومين"). Apply BOTH
 * decorators together on any route the approved Entitlement Matrix
 * (PRD §44.2.1) actually names.
 */
export const RequireEntitlement = (capability: Capability) => SetMetadata(REQUIRED_ENTITLEMENT_METADATA_KEY, capability);
