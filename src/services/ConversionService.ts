/**
 * ConversionService — the single place that records the "normal user turned
 * into a customer" moment and closes the marketing attribution loop.
 *
 * Called from the two organic conversion points in the WhatsApp funnel:
 *   - LeadService.saveLeadRegistration  (user registered = admission/student)
 *   - BookingService booking creation   (user booked a campus visit)
 * and from the admin panel for an operator-confirmed `fee_paid`.
 *
 * Every call is fire-and-forget safe: it logs and swallows errors so a
 * measurement write can never break the customer-facing flow.
 */
import mongoose from 'mongoose';
import ConversionEvent, { ConversionKind } from '../models/ConversionEvent';
import Tenant from '../models/Tenant';
import { campaignService } from './CampaignService';
import { leadScoringService } from './LeadScoringService';

export interface RecordConversionInput {
  /** Real phone (digits). If absent, derived from `jid`. */
  phoneNumber?: string;
  jid?: string;
  kind: ConversionKind;
  /** Explicit tenant; falls back to the `default` tenant when omitted. */
  tenantId?: string;
  leadId?: mongoose.Types.ObjectId | string;
  bookingId?: mongoose.Types.ObjectId | string;
  valueLkr?: number;
  sessionId?: string;
  source?: string;
  note?: string;
}

class ConversionService {
  /** Cached default-tenant _id so we don't hit Mongo on every conversion. */
  private defaultTenantId: string | null = null;

  private async resolveTenantId(explicit?: string): Promise<string | null> {
    if (explicit) return explicit;
    if (this.defaultTenantId) return this.defaultTenantId;
    try {
      const t = await Tenant.findOne({ slug: 'default' }).select('_id').lean();
      const id = (t as { _id?: unknown } | null)?._id;
      if (id) {
        this.defaultTenantId = String(id);
        return this.defaultTenantId;
      }
    } catch {
      /* tenant lookup is best-effort */
    }
    return null;
  }

  private derivePhone(input: RecordConversionInput): string {
    if (input.phoneNumber && input.phoneNumber.trim()) {
      return input.phoneNumber.trim();
    }
    if (input.jid) return input.jid.split('@')[0];
    return '';
  }

  /**
   * Persist a conversion and, for organic lead/booking conversions, credit a
   * recent campaign send via last-touch attribution.
   */
  async recordConversion(input: RecordConversionInput): Promise<void> {
    try {
      const phoneNumber = this.derivePhone(input);
      if (!phoneNumber) {
        console.warn('⚠️ recordConversion: no phone resolvable, skipping.');
        return;
      }

      const tenantId = await this.resolveTenantId(input.tenantId);

      await ConversionEvent.create({
        tenantId: tenantId || undefined,
        phoneNumber,
        jid: input.jid,
        kind: input.kind,
        leadId: input.leadId,
        bookingId: input.bookingId,
        valueLkr: input.valueLkr,
        sessionId: input.sessionId,
        source: input.source || 'whatsapp',
        note: input.note,
      });
      console.log(`💰 [CONVERSION] ${input.kind} captured for ${phoneNumber}`);

      // A conversion is the strongest intent signal — push the lead score.
      leadScoringService
        .onConversion(phoneNumber, tenantId || undefined)
        .catch((err) => console.error('leadScoring.onConversion failed:', err));

      // Close the marketing loop: stamp outcome='converted' on the most recent
      // campaign message we sent this person (last-touch, 14-day window).
      if (
        tenantId &&
        (input.kind === 'lead_registered' || input.kind === 'booking_created')
      ) {
        const corrKind =
          input.kind === 'lead_registered'
            ? 'lead_converted'
            : 'booking_created';
        await campaignService
          .correlateConversion(tenantId, phoneNumber, corrKind, input.jid)
          .catch(() => undefined);
      }
    } catch (err) {
      console.error('❌ recordConversion failed:', err);
    }
  }

  /**
   * Aggregate counts for the admin dashboard — total conversions, a breakdown
   * by kind, and the most recent events.
   */
  async getStats(tenantId?: string): Promise<{
    total: number;
    byKind: Record<string, number>;
    recent: unknown[];
  }> {
    try {
      const match: Record<string, unknown> = {};
      // Cast tenantId to ObjectId. countDocuments()/find() would auto-cast a
      // string, but the aggregate `$match` below is NOT cast by Mongoose — a
      // raw string there matches ZERO ObjectId-typed docs, so byKind would come
      // back empty (Total correct, per-kind tiles all 0). Casting here keeps all
      // three queries consistent.
      if (tenantId) {
        match.tenantId = mongoose.Types.ObjectId.isValid(tenantId)
          ? new mongoose.Types.ObjectId(tenantId)
          : tenantId;
      }
      // Count and group across ALL events (not a 500-row window — that capped
      // `total` and skewed `byKind` once a tenant passed 500 conversions). Only
      // the `recent` list is limited, since that's all the UI shows.
      const [total, byKindAgg, recent] = await Promise.all([
        ConversionEvent.countDocuments(match),
        ConversionEvent.aggregate([
          { $match: match },
          { $group: { _id: '$kind', count: { $sum: 1 } } },
        ]),
        ConversionEvent.find(match).sort({ createdAt: -1 }).limit(20).lean(),
      ]);
      const byKind: Record<string, number> = {};
      for (const g of byKindAgg as Array<{ _id: string; count: number }>) {
        if (g._id) byKind[g._id] = g.count;
      }
      return { total, byKind, recent };
    } catch (err) {
      console.error('❌ ConversionService.getStats failed:', err);
      return { total: 0, byKind: {}, recent: [] };
    }
  }
}

export const conversionService = new ConversionService();
export default conversionService;
