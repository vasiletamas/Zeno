/**
 * Tool Permissions
 *
 * Role-based access control for tool execution.
 * Uses the allowedRoles defined in the tool registry and a simple
 * role hierarchy (CUSTOMER < OPERATOR < ADMIN).
 */

import type { UserRole } from './types'
import { getToolDefinition } from './registry'

// ==============================================
// ROLE HIERARCHY
// ==============================================

const ROLE_HIERARCHY: Record<UserRole, number> = {
  CUSTOMER: 0,
  OPERATOR: 1,
  ADMIN: 2,
}

// ==============================================
// PERMISSION CHECK
// ==============================================

export interface PermissionCheckResult {
  allowed: boolean
  reason?: string
}

/**
 * Check whether a user role is allowed to execute a given tool.
 *
 * Logic:
 *  1. Look up the tool definition from the registry.
 *  2. If the tool is unknown, deny access (safe default).
 *  3. Check if the user's role is explicitly listed in allowedRoles,
 *     or if the user's hierarchy level is >= the minimum required.
 */
export function checkPermission(
  toolName: string,
  userRole: UserRole,
): PermissionCheckResult {
  const definition = getToolDefinition(toolName)

  if (!definition) {
    return {
      allowed: false,
      reason: `Unknown tool: "${toolName}"`,
    }
  }

  const { allowedRoles } = definition

  // Direct role match
  if (allowedRoles.includes(userRole)) {
    return { allowed: true }
  }

  // Hierarchy check: user's level must be >= the lowest required role
  const userLevel = ROLE_HIERARCHY[userRole]
  const minRequiredLevel = Math.min(
    ...allowedRoles.map((role) => ROLE_HIERARCHY[role]),
  )

  if (userLevel >= minRequiredLevel) {
    return { allowed: true }
  }

  return {
    allowed: false,
    reason: `Role "${userRole}" is not permitted to execute "${toolName}". Required: ${allowedRoles.join(', ')}.`,
  }
}
