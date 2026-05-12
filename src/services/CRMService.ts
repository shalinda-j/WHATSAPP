import { Contact, Deal, Activity, PipelineStage } from '../models/CRM';

/**
 * SECURITY FIX: Escape regex special characters to prevent regex injection
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    } = options;

    const query: any = {};

    // Filters
    if (type) query.type = type;
    if (status) query.status = status;
    if (source) query.source = source;
    if (tags && tags.length > 0) query.tags = { $in: tags };

    // Search - SECURITY FIX: Escape regex to prevent injection
    if (search) {
      const escapedSearch = escapeRegex(search);
      query.$or = [
        { name: { $regex: escapedSearch, $options: 'i' } },
        { firstName: { $regex: escapedSearch, $options: 'i' } },
        { lastName: { $regex: escapedSearch, $options: 'i' } },
        { email: { $regex: escapedSearch, $options: 'i' } },
        { phone: { $regex: escapedSearch, $options: 'i' } },
        { company: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

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
  static async getContactById(id: string) {
    return Contact.findById(id).populate('owner', 'username email');
  }

  /**
   * Create a new contact
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
  static async updateContact(id: string, data: any) {
    return Contact.findByIdAndUpdate(
      id,
      { ...data, updatedAt: new Date() },
      { new: true },
    );
  }

  /**
   * Delete a contact
   */
  static async deleteContact(id: string) {
    // Also delete related activities
    await Activity.deleteMany({ contact: id });
    // Update deals to remove contact reference
    await Deal.updateMany({ contact: id }, { $unset: { contact: 1 } });
    return Contact.findByIdAndDelete(id);
  }

  /**
   * Get contact statistics
   */
  static async getContactStats() {
    const [total, byType, byStatus, bySource] = await Promise.all([
      Contact.countDocuments(),
      Contact.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
      Contact.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Contact.aggregate([{ $group: { _id: '$source', count: { $sum: 1 } } }]),
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
    } = {},
  ) {
    const { page = 1, limit = 20, search, stage, contact, owner } = options;

    const query: any = {};

    if (stage) query.stage = stage;
    if (contact) query.contact = contact;
    if (owner) query.owner = owner;

    if (search) {
      // SECURITY FIX: Escape regex to prevent injection
      const escapedSearch = escapeRegex(search);
      query.$or = [
        { title: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } },
      ];
    }

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
   * Get deals grouped by stage (for Kanban)
   */
  static async getDealsByStage() {
    const deals = await Deal.find()
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
  static async getDealById(id: string) {
    return Deal.findById(id)
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
  static async updateDeal(id: string, data: any) {
    const updateData: any = { ...data, updatedAt: new Date() };

    // Set actual close date if won/lost
    if (data.stage === 'won' || data.stage === 'lost') {
      updateData.actualCloseDate = new Date();
    }

    return Deal.findByIdAndUpdate(id, updateData, { new: true });
  }

  /**
   * Delete a deal
   */
  static async deleteDeal(id: string) {
    await Activity.deleteMany({ deal: id });
    return Deal.findByIdAndDelete(id);
  }

  /**
   * Get deal statistics
   */
  static async getDealStats() {
    const [total, byStage, totalValue, wonValue] = await Promise.all([
      Deal.countDocuments(),
      Deal.aggregate([
        {
          $group: {
            _id: '$stage',
            count: { $sum: 1 },
            value: { $sum: '$value' },
          },
        },
      ]),
      Deal.aggregate([{ $group: { _id: null, total: { $sum: '$value' } } }]),
      Deal.aggregate([
        { $match: { stage: 'won' } },
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
    } = options;

    const query: any = {};

    if (type) query.type = type;
    if (contact) query.contact = contact;
    if (deal) query.deal = deal;
    if (status) query.status = status;
    if (owner) query.owner = owner;
    if (upcoming) {
      query.dueDate = { $gte: new Date() };
      query.status = 'pending';
    }

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
  static async getActivityById(id: string) {
    return Activity.findById(id)
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
  static async updateActivity(id: string, data: any) {
    const updateData: any = { ...data, updatedAt: new Date() };

    // Set completed date if status is completed
    if (data.status === 'completed' && !data.completedAt) {
      updateData.completedAt = new Date();
    }

    return Activity.findByIdAndUpdate(id, updateData, { new: true });
  }

  /**
   * Delete an activity
   */
  static async deleteActivity(id: string) {
    return Activity.findByIdAndDelete(id);
  }

  /**
   * Get upcoming activities (for dashboard)
   */
  static async getUpcomingActivities(limit = 10) {
    return Activity.find({
      status: 'pending',
      dueDate: { $gte: new Date() },
    })
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
  static async getDashboardStats() {
    const [
      contactStats,
      dealStats,
      upcomingActivities,
      recentContacts,
      recentDeals,
    ] = await Promise.all([
      this.getContactStats(),
      this.getDealStats(),
      this.getUpcomingActivities(5),
      Contact.find().sort({ createdAt: -1 }).limit(5),
      Deal.find()
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
  static async globalSearch(query: string) {
    const searchRegex = new RegExp(query, 'i');

    const [contacts, deals, activities] = await Promise.all([
      Contact.find({
        $or: [
          { name: searchRegex },
          { firstName: searchRegex },
          { lastName: searchRegex },
          { email: searchRegex },
          { company: searchRegex },
        ],
      }).limit(10),
      Deal.find({
        $or: [{ title: searchRegex }, { description: searchRegex }],
      })
        .limit(10)
        .populate('contact', 'firstName lastName'),
      Activity.find({
        $or: [{ title: searchRegex }, { description: searchRegex }],
      })
        .limit(10)
        .populate('contact', 'firstName lastName'),
    ]);

    return { contacts, deals, activities };
  }
}
