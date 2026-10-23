/**
 * Role-Based Access Control (RBAC) & Granular Permission Middleware
 */

export function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.user.role === 'owner') {
      return next(); // Owner has full access
    }

    if (allowedRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      error: 'Forbidden: Insufficient role permissions',
      requiredRoles: allowedRoles,
      userRole: req.user.role
    });
  };
}

export function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Owner always has all permissions
    if (req.user.role === 'owner') {
      return next();
    }

    if (req.user.permissions && req.user.permissions[permissionKey] === true) {
      return next();
    }

    return res.status(403).json({
      error: `Forbidden: You do not have the '${permissionKey}' permission`,
      permissionRequired: permissionKey
    });
  };
}
