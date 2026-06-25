import { Contact, Deal, Activity, PipelineStage } from '../models/CRM';

/**
 * SECURITY FIX: Escape regex special characters to prevent regex injection
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a query that scopes results to a tenant while still surfacing
 * legacy documents created before the tenantId field existed. Returns
 * `{}` when no tenantId is supplied (admin / migration scripts).
 */
function buildTenantFilter(tenantId?: string): Record<string, unknown> {
  if (!tenantId) return {};
  return { $or: [{ tenantId }, { tenantId: { $exists: false } }] };
}

/**
 * Per-device scope: narrow to one WhatsApp session while still surfacing
 * legacy rows that pre-date the sessionId field. Operator picks "All
 * devices" by passing `undefined` (no filter applied).
 */
function buildSessionFilter(sessionId?: string): Record<string, unknown> {
  if (!sessionId || sessionId === 'all') return {};
  return { $or: [{ sessionId }, { sessionId: { $exists: false } }] };
}

/**
 * Combine a base filter, an optional tenant filter and an optional search
 * filter (each of which may itself use $or) into a single Mongo query
 * without one $or overwriting another. The $and form is used whenever two
 * or more $or-bearing clauses need to coexist.
 */
function combineQuery(
  base: Record<string, unknown>,
  ...clauses: Array<Record<string, unknown>>
): Record<string, unknown> {
  const nonEmpty = clauses.filter((c) => Object.keys(c).length > 0);
  if (nonEmpty.length === 0) return base;
  if (nonEmpty.length === 1) return { ...base, ...nonEmpty[0] };
  return { ...base, $and: nonEmpty };
}

export class CRMService {
  // ==================== CONTACTS ====================

  /**
   * Get all contacts with filtering and pagination
   */
  static async getContacts(
    options: {
      page?: number;
      limit?: number;
      search?: string;
      type?: string;
      status?: string;
      source?: string;
      tags?: string[];
      /**
       * Multi-tenant scope. Routes that go through resolveTenant
       * middleware should pass this so the list narrows to the active
       * tenant's contacts only. Backwards-compatible: callers that
       * don't pass it get the unfiltered behaviour (used by tooling
       * and migration scripts that legitimately need cross-tenant
       * visibility).
       */
      tenantId?: string;
      /** Per-device scope. Pass a WhatsApp sessionId to narrow the
       *  list to records owned by that specific device. */
      sessionId?: string;
    } = {},
  ) {
    const {
      page = 1,
      limit = 20,
      search,
      type,
      status,
      source,
      tags,
      tenantId,
      sessionId,
    } = options;

    const base: Record<string, unknown> = {};
    if (type) base.type = type;
    if (status) base.status = status;
    if (source) base.source = source;
    if (tags && tags.length > 0) base.tags = { $in: tags };

    const tenantFilter = buildTenantFilter(tenantId);
    const sessionFilter = buildSessionFilter(sessionId);

    // Search - SECURITY FIX: Escape regex to prevent injection
    const searchFilter: Record<string, unknown> = search
      ? {
          $or: [
            { name: { $regex: escapeRegex(search), $options: 'i' } },
            { firstName: { $regex: escapeRegex(search), $options: 'i' } },
            { lastName: { $regex: escapeRegex(search), $options: 'i' } },
            { email: { $regex: escapeRegex(search), $options: 'i' } },
            { phone: { $regex: escapeRegex(search), $options: 'i' } },
            { company: { $regex: escapeRegex(search), $options: 'i' } },
          ],
        }
      : {};

    const query = combineQuery(base, tenantFilter, sessionFilter, searchFilter);

    const total = await Contact.countDocuments(query);
    const contacts = await Contact.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('owner', 'username email');

    return {
      contacts,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a single contact by ID
   */
  static async getContactById(id: string, tenantId?: string) {
    // SECURITY: when a tenantId is supplied, refuse to surface contacts
    // owned by another tenant. Legacy contacts with no tenantId remain
    // accessible (single-tenant deployments) via the $exists fallback.
    const query: Record<string, unknown> = { _id: id };
    if (tenantId) {
      query.$or = [{ tenantId }, { tenantId: { $exists: false } }];
    }
    return Contact.findOne(query).populate('owner', 'username email');
  }

  /**
   * Create a new contact. `data.tenantId` should be supplied by the route
   * (from req.tenant._id) so the row is scoped on insert. Without it the
   * contact will be invisible to tenant-scoped list queries.
   */
  static async createContact(data: any) {
    // Auto-populate name from firstName/lastName if not provided
    if (!data.name && (data.firstName || data.lastName)) {
      data.name = `${data.firstName || ''} ${data.lastName || ''}`.trim();
    }
    // Auto-populate firstName/lastName from name if not provided
    if (data.name && !data.firstName && !data.lastName) {
      const parts = data.name.split(' ');
      data.firstName = parts[0];
      data.lastName = parts.slice(1).join(' ') || '';
    }
    // Sync whatsappId and whatsappNumber
    if (data.whatsappId && !data.whatsappNumber) {
      data.whatsappNumber = data.whatsappId;
    }
    if (data.whatsappNumber && !data.whatsappId) {
      data.whatsappId = data.whatsappNumber;
    }

    const contact = new Contact({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return contact.save();
  }

  /**
   * Update a contact
   */
  static async updateContact(id: string, data: any, tenantId?: string) {
    // SECURITY: strip any client-supplied tenantId so a caller can't
    // re-stamp this row into another tenant.
    const { tenantId: _ignore, ...safeData } = data ?? {};
    const query: Record<string, unknown> = { _id: id };
    if (tenantId) {
      query.$or = [
        { tenantId },
        { tenantId: { $exists: false } },
        { tenantId: null },
      ];
    }
    return Contact.findOneAndUpdate(
      query,
      { ...safeData, updatedAt: new Date() },
      { new: true },
    );
  }

  /**
   * Delete a contact
   */
  static async deleteContact(id: string, tenantId?: string) {
    const tenantClause = tenantId
      ? {
          $or: [
            { tenantId },
            { tenantId: { $exists: false } },
            { tenantId: null },
          ],
        }
      : {};
    // Resolve the tenant-scoped contact first so we never touch another
    // tenant's related rows when the id belongs to a different tenant.
    const contact = await Contact.findOneAndDelete({
      _id: id,
      ...tenantClause,
    });
    if (!contact) return null;
    // Cascade only after confirming ownership: delete related activities and
    // unset the contact reference on this tenant's deals.
    await Activity.deleteMany({ contact: id, ...tenantClause });
    await Deal.updateMany(
      { contact: id, ...tenantClause },
      { $unset: { contact: 1 } },
    );
    return contact;
  }

  /**
   * Get contact statistics
   */
  static async getContactStats(tenantId?: string, sessionId?: string) {
    const scope = combineQuery(
      {},
      buildTenantFilter(tenantId),
      buildSessionFilter(sessionId),
    );
    const matchStage = Object.keys(scope).length > 0 ? [{ $match: scope }] : [];
    const [total, byType, byStatus, bySource] = await Promise.all([
      Contact.countDocuments(scope),
      Contact.aggregate([
        ...matchStage,
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      Contact.aggregate([
        ...matchStage,
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Contact.aggregate([
        ...matchStage,
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]),
    ]);

    return {
      total,
      byType: byType.reduce((acc: Record<string, number>, item: any) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
      byStatus: byStatus.reduce((acc: Record<string, number>, item: any) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
      bySource: bySource.reduce((acc: Record<string, number>, item: any) => {
        acc[item._id || 'unknown'] = item.count;
        return acc;
      }, {}),
    };
  }

  // ==================== DEALS ====================

  /**
   * Get all deals with filtering
   */
  static async getDeals(
    options: {
      page?: number;
      limit?: number;
      search?: string;
      stage?: string;
      contact?: string;
      owner?: string;
      tenantId?: string;
      sessionId?: string;
    } = {},
  ) {
    const {
      page = 1,
      limit = 20,
      search,
      stage,
      contact,
      owner,
      tenantId,
      sessionId,
    } = options;

    const base: Record<string, unknown> = {};
    if (stage) base.stage = stage;
    if (contact) base.contact = contact;
    if (owner) base.owner = owner;

    const tenantFilter = buildTenantFilter(tenantId);
    const sessionFilter = buildSessionFilter(sessionId);
    const searchFilter: Record<string, unknown> = search
      ? {
          $or: [
            { title: { $regex: escapeRegex(search), $options: 'i' } },
            { description: { $regex: escapeRegex(search), $options: 'i' } },
          ],
        }
      : {};

    const query = combineQuery(base, tenantFilter, sessionFilter, searchFilter);

    const total = await Deal.countDocuments(query);
    const deals = await Deal.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('contact', 'name firstName lastName email phone company')
      .populate('owner', 'username email');

    return {
      deals,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get deals grouped by stage (for Kanban). Pass `tenantId` to scope to a
   * single tenant's pipeline; omit it for cross-tenant admin views.
   */
  static async getDealsByStage(tenantId?: string, sessionId?: string) {
    const query = combineQuery(
      {},
      buildTenantFilter(tenantId),
      buildSessionFilter(sessionId),
    );
    const deals = await Deal.find(query)
      .sort({ createdAt: -1 })
      .populate('contact', 'name firstName lastName email phone company')
      .populate('owner', 'username email');

    const grouped: Record<string, any[]> = {
      new: [],
      qualified: [],
      proposal: [],
      negotiation: [],
      won: [],
      lost: [],
    };

    deals.forEach((deal: any) => {
      const stage = deal.stage as string;
      if (grouped[stage]) {
        grouped[stage].push(deal);
      }
    });

    return grouped;
  }

  /**
   * Get a single deal
   */
  static async getDealById(id: string, tenantId?: string) {
    const query: Record<string, unknown> = { _id: id };
    if (tenantId) {
      query.$or = [{ tenantId }, { tenantId: { $exists: false } }];
    }
    return Deal.findOne(query)
      .populate('contact', 'name firstName lastName email phone company')
      .populate('owner', 'username email');
  }

  /**
   * Create a new deal
   */
  static async createDeal(data: any) {
    const deal = new Deal({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return deal.save();
  }

  /**
   * Update a deal
   */
  static async updateDeal(id: string, data: any, tenantId?: string) {
    // SECURITY: strip any client-supplied tenantId so a caller can't
    // re-stamp this row into another tenant.
    const { tenantId: _ignore, ...safeData } = data ?? {};
    const updateData: any = { ...safeData, updatedAt: new Date() };

    // Set actual close date if won/lost
    if (data.stage === 'won' || data.stage === 'lost') {
      updateData.actualCloseDate = new Date();
    }

    const query: Record<string, unknown> = { _id: id };
    if (tenantId) {
      query.$or = [
        { tenantId },
        { tenantId: { $exists: false } },
        { tenantId: null },
      ];
    }
    return Deal.findOneAndUpdate(query, updateData, { new: true });
  }

  /**
   * Delete a deal
   */
  static async deleteDeal(id: string, tenantId?: string) {
    const tenantClause = tenantId
      ? {
          $or: [
            { tenantId },
            { tenantId: { $exists: false } },
            { tenantId: null },
          ],
        }
      : {};
    // Resolve the tenant-scoped deal first so cascading deletes never touch
    // another tenant's activities.
    const deal = await Deal.findOneAndDelete({ _id: id, ...tenantClause });
    if (!deal) return null;
    await Activity.deleteMany({ deal: id, ...tenantClause });
    return deal;
  }

  /**
   * Get deal statistics
   */
  static async getDealStats(tenantId?: string, sessionId?: string) {
    const scope = combineQuery(
      {},
      buildTenantFilter(tenantId),
      buildSessionFilter(sessionId),
    );
    const matchStage = Object.keys(scope).length > 0 ? [{ $match: scope }] : [];
    const [total, byStage, totalValue, wonValue] = await Promise.all([
      Deal.countDocuments(scope),
      Deal.aggregate([
        ...matchStage,
        {
          $group: {
            _id: '$stage',
            count: { $sum: 1 },
            value: { $sum: '$value' },
          },
        },
      ]),
      Deal.aggregate([
        ...matchStage,
        { $group: { _id: null, total: { $sum: '$value' } } },
      ]),
      Deal.aggregate([
        { $match: { ...scope, stage: 'won' } },
        { $group: { _id: null, total: { $sum: '$value' } } },
      ]),
    ]);

    return {
      total,
      totalValue: totalValue[0]?.total || 0,
      wonValue: wonValue[0]?.total || 0,
      byStage: byStage.reduce((acc: Record<string, any>, item: any) => {
        acc[item._id] = { count: item.count, value: item.value };
        return acc;
      }, {}),
    };
  }

  // ==================== ACTIVITIES ====================

  /**
   * Get activities with filtering
   */
  static async getActivities(
    options: {
      page?: number;
      limit?: number;
      type?: string;
      contact?: string;
      deal?: string;
      status?: string;
      owner?: string;
      upcoming?: boolean;
      tenantId?: string;
      sessionId?: string;
    } = {},
  ) {
    const {
      page = 1,
      limit = 20,
      type,
      contact,
      deal,
      status,
      owner,
      upcoming,
      tenantId,
      sessionId,
    } = options;

    const base: Record<string, unknown> = {};
    if (type) base.type = type;
    if (contact) base.contact = contact;
    if (deal) base.deal = deal;
    if (status) base.status = status;
    if (owner) base.owner = owner;
    if (upcoming) {
      base.dueDate = { $gte: new Date() };
      base.status = 'pending';
    }

    const tenantFilter = buildTenantFilter(tenantId);
    const sessionFilter = buildSessionFilter(sessionId);
    const query = combineQuery(base, tenantFilter, sessionFilter);

    const total = await Activity.countDocuments(query);
    const activities = await Activity.find(query)
      .sort({ dueDate: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('contact', 'firstName lastName email phone')
      .populate('deal', 'title value stage')
      .populate('owner', 'username email');

    return {
      activities,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a single activity
   */
  static async getActivityById(id: string, tenantId?: string) {
    const query: Record<string, unknown> = { _id: id };
    if (tenantId) {
      query.$or = [
        { tenantId },
        { tenantId: { $exists: false } },
        { tenantId: null },
      ];
    }
    return Activity.findOne(query)
      .populate('contact', 'firstName lastName email phone')
      .populate('deal', 'title value stage')
      .populate('owner', 'username email');
  }

  /**
   * Create an activity
   */
  static async createActivity(data: any) {
    const activity = new Activity({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return activity.save();
  }

  /**
   * Update an activity
   */
  static async updateActivity(id: string, data: any, tenantId?: string) {
    // SECURITY: strip any client-supplied tenantId so a caller can't
    // re-stamp this row into another tenant.
    const { tenantId: _ignore, ...safeData } = data ?? {};
    const updateData: any = { ...safeData, updatedAt: new Date() };

    // Set completed date if status is completed
    if (data.status === 'completed' && !data.completedAt) {
      updateData.completedAt = new Date();
    }

    const query: Record<string, unknown> = { _id: id };
    if (tenantId) {
      query.$or = [
        { tenantId },
        { tenantId: { $exists: false } },
        { tenantId: null },
      ];
    }
    return Activity.findOneAndUpdate(query, updateData, { new: true });
  }

  /**
   * Delete an activity
   */
  static async deleteActivity(id: string, tenantId?: string) {
    const query: Record<string, unknown> = { _id: id };
    if (tenantId) {
      query.$or = [
        { tenantId },
        { tenantId: { $exists: false } },
        { tenantId: null },
      ];
    }
    return Activity.findOneAndDelete(query);
  }

  /**
   * Get upcoming activities (for dashboard)
   */
  static async getUpcomingActivities(
    limit = 10,
    tenantId?: string,
    sessionId?: string,
  ) {
    const base = {
      status: 'pending',
      dueDate: { $gte: new Date() },
    };
    const query = combineQuery(
      base,
      buildTenantFilter(tenantId),
      buildSessionFilter(sessionId),
    );
    return Activity.find(query)
      .sort({ dueDate: 1 })
      .limit(limit)
      .populate('contact', 'firstName lastName email phone')
      .populate('deal', 'title value stage');
  }

  // ==================== PIPELINE STAGES ====================

  /**
   * Get all pipeline stages
   */
  static async getPipelineStages() {
    return PipelineStage.find({ isActive: true }).sort({ order: 1 });
  }

  /**
   * Create a pipeline stage
   */
  static async createPipelineStage(data: any) {
    const stage = new PipelineStage(data);
    return stage.save();
  }

  /**
   * Update a pipeline stage
   */
  static async updatePipelineStage(id: string, data: any) {
    return PipelineStage.findByIdAndUpdate(id, data, { new: true });
  }

  /**
   * Delete a pipeline stage
   */
  static async deletePipelineStage(id: string) {
    return PipelineStage.findByIdAndDelete(id);
  }

  // ==================== DASHBOARD ====================

  /**
   * Get CRM dashboard stats
   */
  static async getDashboardStats(tenantId?: string, sessionId?: string) {
    const scope = combineQuery(
      {},
      buildTenantFilter(tenantId),
      buildSessionFilter(sessionId),
    );
    const [
      contactStats,
      dealStats,
      upcomingActivities,
      recentContacts,
      recentDeals,
    ] = await Promise.all([
      this.getContactStats(tenantId, sessionId),
      this.getDealStats(tenantId, sessionId),
      this.getUpcomingActivities(5, tenantId, sessionId),
      Contact.find(scope).sort({ createdAt: -1 }).limit(5),
      Deal.find(scope)
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('contact', 'firstName lastName'),
    ]);

    // Calculate conversion rate
    const wonDeals = dealStats.byStage?.won?.count || 0;
    const totalDeals = dealStats.total || 0;
    const conversionRate =
      totalDeals > 0 ? ((wonDeals / totalDeals) * 100).toFixed(1) : '0';

    return {
      contacts: contactStats,
      deals: dealStats,
      conversionRate,
      upcomingActivities,
      recentContacts,
      recentDeals,
    };
  }

  // ==================== SEARCH ====================

  /**
   * Global search across contacts, deals, and activities
   */
  static async globalSearch(query: string, tenantId?: string) {
    // SECURITY: escape user input before constructing the regex. Raw
    // user-controlled strings in `new RegExp(...)` would allow regex
    // injection (e.g. catastrophic backtracking, denial-of-service via
    // `(a+)+$`-style patterns).
    const searchRegex = new RegExp(escapeRegex(query), 'i');

    // Tenant scope: AND the tenant clause into each search so results never
    // leak across tenants. Legacy rows without a tenantId stay visible.
    const tenantClause = buildTenantFilter(tenantId);

    const [contacts, deals, activities] = await Promise.all([
      Contact.find(
        combineQuery(
          {
            $or: [
              { name: searchRegex },
              { firstName: searchRegex },
              { lastName: searchRegex },
              { email: searchRegex },
              { company: searchRegex },
            ],
          },
          tenantClause,
        ),
      ).limit(10),
      Deal.find(
        combineQuery(
          {
            $or: [{ title: searchRegex }, { description: searchRegex }],
          },
          tenantClause,
        ),
      )
        .limit(10)
        .populate('contact', 'firstName lastName'),
      Activity.find(
        combineQuery(
          {
            $or: [{ title: searchRegex }, { description: searchRegex }],
          },
          tenantClause,
        ),
      )
        .limit(10)
        .populate('contact', 'firstName lastName'),
    ]);

    return { contacts, deals, activities };
  }
}
