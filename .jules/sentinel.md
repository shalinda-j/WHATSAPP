## 2026-05-30 - Prevent IDOR in Dataset APIs

**Vulnerability:** Found multiple instances in `src/server/routes/datasets.ts` where unscoped database queries like `findById`, `findByIdAndUpdate`, and `findByIdAndDelete` were used directly with `req.params.id`. This could lead to Insecure Direct Object Reference (IDOR) vulnerabilities, allowing users to view, update, or delete datasets belonging to other tenants.

**Learning:** When interacting with multi-tenant MongoDB collections in an Express app, unscoped query methods bypass tenant isolation mechanisms, even if a tenant middleware runs on the route.

**Prevention:** Always use scoped query methods such as `findOne`, `findOneAndUpdate`, and `findOneAndDelete` by wrapping the filter with `withTenantScope(req, { _id: req.params.id })`. This enforces that users can only interact with their own tenant's data.
