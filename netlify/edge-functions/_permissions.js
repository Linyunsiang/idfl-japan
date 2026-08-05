// Central route -> minimum role map. Edit HERE only.
// Roles: PUBLIC < CUSTOMER < STAFF
export const routePermissions = [
  // STAFF (IDFL staff / admin only)
  { prefix: '/converter',            role: 'STAFF' },   // Certificate PDF -> Excel converter
  { prefix: '/admin',                role: 'STAFF' },   // unified admin console
  { prefix: '/files/staff/',         role: 'STAFF' },   // staff-only downloadable files
  // CUSTOMER (customers / seminar participants / certified companies)
  { prefix: '/customer/',            role: 'CUSTOMER' },// customer tools area (advanced calc, SDS, volume, TC deadline, seminar materials...)
  { prefix: '/files/customer/',      role: 'CUSTOMER' },// customer-only files
];
export function requiredRole(pathname){
  for (const r of routePermissions){
    if (pathname === r.prefix || pathname.startsWith(r.prefix)) return r.role;
  }
  return 'PUBLIC';
}
