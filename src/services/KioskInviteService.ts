/**
 * KioskInviteService — issues, redeems and converts the short-lived 4-digit
 * codes that bridge a customer's WhatsApp thread onto an in-branch voice kiosk.
 *
 * Design contract:
 *   - The kiosk userId is the customer WhatsApp JID (the thread continues).
 *   - Conversion is AI-auto-detected, CONSERVATIVE and IDEMPOTENT: repeated
 *     markConverted() calls never double-record a conversion.
 *   - Code delivery over WhatsApp is best-effort; a send failure never breaks
 *     issue().
 */
import mongoose from 'mongoose';
import KioskInvite from '../models/KioskInvite';
import Dataset from '../models/Dataset';
import { sendMessage } from './whatsapp';
import { CRMService } from './CRMService';
import { conversionService } from './ConversionService';

/**
 * Code lifetime. Defaults to 7 days; override with KIOSK_CODE_TTL (milliseconds).
 */
const KIOSK_CODE_TTL_MS = (() => {
  const raw = Number(process.env.KIOSK_CODE_TTL);
  return Number.isFinite(raw) && raw > 0 ? raw : 7 * 24 * 60 * 60 * 1000;
})();

/** The ONE place the branch fallback literal lives. */
const DEFAULT_BRANCH = (process.env.BRANCH_NAME || 'Pasyala').trim() || 'Pasyala';

// Lazy Contact model lookup to avoid a circular import with the CRM layer
// (mirrors AutoRegistrationService).
const getContactModel = (): mongoose.Model<any> | null => {
  try {
    return mongoose.model('Contact');
  } catch {
    return null;
  }
};

export interface IssueInput {
  contactId?: string;
  phone?: string;
  jid?: string;
  branch?: string;
  tenantId?: string;
  sessionId?: string;
  /** Link the code back to the Booking it was issued for (visit bookings). */
  bookingId?: string;
  // When false, the code is created but NOT delivered over WhatsApp — the
  // caller sends its own message (e.g. the booking flow includes the code in
  // the appointment-confirmation message instead of a duplicate one). Defaults
  // to true (the manual CRM "Issue code" button relies on the auto-delivery).
  deliver?: boolean;
  // Override the default 7-day code expiry. The booking flow sets this so the
  // code stays valid through the customer's actual visit day even when the
  // appointment is more than a week out.
  expiresAt?: Date;
}

export interface RedeemResult {
  invite: any;
  contact: any | null;
  name: string;
}

class KioskInviteService {
  /** 4-digit code, 1000–9999. */
  private generateCode(): string {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  /**
   * Resolve the branch label from the BRANCH_NAME dataset/config row, falling
   * back to DEFAULT_BRANCH. Multilanguage content collapses to en → si → ta.
   */
  private async resolveBranch(): Promise<string> {
    try {
      const ds: any = await Dataset.findOne({ key: 'BRANCH_NAME' }).lean();
      const c = ds?.content;
      const val =
        typeof c === 'string' ? c : c?.en || c?.si || c?.ta || ds?.name;
      if (val && String(val).trim()) return String(val).trim();
    } catch {
      /* best-effort — fall through to the default */
    }
    return DEFAULT_BRANCH;
  }

  /**
   * Find the CRM contact for an invite via the same phone/whatsappId $or dedup
   * AutoRegistrationService uses, preferring an explicit contactId.
   */
  private async resolveContact(opts: {
    contactId?: string;
    phone?: string;
    jid?: string;
    tenantId?: unknown;
  }): Promise<any | null> {
    const Contact = getContactModel();
    if (!Contact) return null;

    // Tenant-tolerant scope: restrict to the invite's tenant while still
    // matching legacy un-tenanted contacts. Without this, the phone/JID $or
    // could resolve a DIFFERENT tenant's contact that shares the number and
    // then stamp that foreign contactId/phone onto the invite (cross-tenant
    // leak). Returns null clause when no tenant is known (legacy behaviour).
    const tenantClause = opts.tenantId
      ? {
          $or: [
            { tenantId: opts.tenantId },
            { tenantId: { $exists: false } },
            { tenantId: null },
          ],
        }
      : null;
    const scoped = (base: Record<string, unknown>): Record<string, unknown> =>
      tenantClause ? { $and: [base, tenantClause] } : base;

    if (opts.contactId) {
      const byId = await Contact.findOne(scoped({ _id: opts.contactId })).catch(
        () => null,
      );
      if (byId) return byId;
    }

    const or: Record<string, unknown>[] = [];
    if (opts.jid) {
      or.push({ whatsappNumber: opts.jid }, { whatsappId: opts.jid });
    }
    if (opts.phone) {
      const bare = opts.phone.replace(/^\+/, '');
      or.push(
        { phone: opts.phone },
        { phone: `+${bare}` },
        { phone: bare },
        { whatsappNumber: bare },
        { whatsappId: bare },
      );
    }
    if (!or.length) return null;
    return Contact.findOne(scoped({ $or: or })).catch(() => null);
  }

  private displayName(contact: any | null, phone?: string): string {
    const fromContact =
      contact?.name ||
      [contact?.firstName, contact?.lastName].filter(Boolean).join(' ').trim();
    if (fromContact) return String(fromContact).trim();
    if (phone) return `User ${String(phone).replace(/\D/g, '').slice(-4)}`;
    return 'Guest';
  }

  /**
   * Issue a new kiosk code for a (resolved) customer and deliver it over
   * WhatsApp best-effort. Never throws on a delivery failure.
   */
  async issue(
    input: IssueInput,
  ): Promise<{ code: string; invite: any }> {
    let { contactId, phone, jid } = input;

    // Fill phone / jid / contactId from the CRM contact when we can.
    const contact = await this.resolveContact({
      contactId,
      phone,
      jid,
      tenantId: input.tenantId,
    });
    if (contact) {
      contactId = contactId || String(contact._id);
      phone = phone || contact.phone || contact.whatsappNumber || undefined;
      jid =
        jid || contact.whatsappId || contact.whatsappNumber || undefined;
    }

    const branch = (input.branch && input.branch.trim()) || (await this.resolveBranch());
    // Caller may pin the expiry (booking flow → valid through the visit day);
    // otherwise fall back to the default rolling TTL.
    const expiresAt =
      input.expiresAt instanceof Date && !isNaN(input.expiresAt.getTime())
        ? input.expiresAt
        : new Date(Date.now() + KIOSK_CODE_TTL_MS);

    let invite: any = null;
    let code = '';
    // Regenerate on the partial-unique collision (another ACTIVE issued code).
    for (let attempt = 0; attempt < 6 && !invite; attempt++) {
      code = this.generateCode();
      try {
        invite = await KioskInvite.create({
          tenantId: input.tenantId || undefined,
          code,
          contactId: contactId || undefined,
          bookingId: input.bookingId || undefined,
          phone,
          jid,
          branch,
          status: 'issued',
          sessionId: input.sessionId,
          expiresAt,
        } as any);
      } catch (err: any) {
        if (err?.code === 11000) {
          invite = null;
          continue;
        }
        throw err;
      }
    }
    if (!invite) {
      throw new Error('Failed to generate a unique kiosk code');
    }

    // Best-effort WhatsApp delivery — a send failure must NOT bubble up.
    // Skipped when the caller opts out (deliver:false) to avoid a duplicate
    // message (e.g. the booking confirmation already carries the code, or the
    // caller wants to deliver it fire-and-forget without blocking a response).
    if (jid && input.deliver !== false) {
      await this.deliverCode({ jid, code, branch, sessionId: input.sessionId });
    }

    return { code, invite };
  }

  /**
   * Send a kiosk code to a customer over WhatsApp (best-effort — never throws).
   * The single source of the delivery message, shared by issue() and by callers
   * that want to deliver AFTER responding (e.g. the admin booking flow, which
   * saves the code synchronously then fires delivery so the Humanizer typing
   * delay doesn't block the HTTP response).
   */
  async deliverCode(opts: {
    jid?: string;
    code: string;
    branch?: string;
    sessionId?: string;
  }): Promise<void> {
    if (!opts.jid) return;
    try {
      const branch = opts.branch || (await this.resolveBranch());
      const message =
        `🔢 ඔබගේ Kiosk කේතය: *${opts.code}*\n\n` +
        `${branch} ශාඛාවේ kiosk තිරයේ මෙම කේතය ඇතුළු කර ඔබගේ සංවාදය දිගටම කරගෙන යන්න.\n` +
        `(මෙම කේතය නියමිත කාලයකින් කල් ඉකුත් වේ.)`;
      await sendMessage(opts.jid, message, opts.sessionId || 'default');
    } catch (err) {
      console.error(
        '⚠️ Kiosk code WhatsApp delivery failed (best-effort):',
        (err as any)?.message || err,
      );
    }
  }

  /**
   * Atomically redeem an active code, flipping issued → redeemed, and return
   * the linked contact + a display name. Returns null when the code is
   * invalid / already used / expired.
   */
  async redeem(
    code: string,
    _tenantId?: string,
  ): Promise<RedeemResult | null> {
    if (!code || !/^\d{4}$/.test(String(code).trim())) return null;

    const invite: any = await KioskInvite.findOneAndUpdate(
      { code: String(code).trim(), status: 'issued', expiresAt: { $gt: new Date() } },
      { $set: { status: 'redeemed', redeemedAt: new Date() } },
      { new: true },
    );
    if (!invite) return null;

    const contact = await this.resolveContact({
      contactId: invite.contactId ? String(invite.contactId) : undefined,
      phone: invite.phone,
      jid: invite.jid,
      tenantId: invite.tenantId,
    });

    return {
      invite,
      contact,
      name: this.displayName(contact, invite.phone),
    };
  }

  /**
   * IDEMPOTENT conversion. Flips the invite to `converted` atomically and only
   * runs the side effects (CRM upgrade + ConversionEvent) when THIS call won
   * the flip — so repeated calls never double-record.
   *
   * @returns true if this call performed the conversion, false if it was
   *          already converted (or the invite was not found).
   */
  async markConverted(inviteId: string): Promise<boolean> {
    if (!inviteId) return false;

    // Single-writer guard: only the call that transitions away from a
    // non-converted state proceeds.
    const invite: any = await KioskInvite.findOneAndUpdate(
      { _id: inviteId, status: { $ne: 'converted' } },
      { $set: { status: 'converted' } },
      { new: true },
    ).catch(() => null);

    if (!invite) return false; // already converted, or not found

    const tenantId = invite.tenantId ? String(invite.tenantId) : undefined;

    // Upgrade the CRM contact to a paying customer (tenant-scoped).
    if (invite.contactId) {
      try {
        await CRMService.updateContact(
          String(invite.contactId),
          { status: 'converted', type: 'customer' },
          tenantId,
        );
      } catch (err) {
        console.error(
          '⚠️ Kiosk markConverted: CRM updateContact failed:',
          (err as any)?.message || err,
        );
      }
    }

    // Record the funnel conversion (fire-and-forget safe internally).
    try {
      await conversionService.recordConversion({
        phoneNumber: invite.phone,
        jid: invite.jid,
        kind: 'enrollment' as any,
        tenantId,
        sessionId: invite.sessionId,
        source: 'kiosk',
      });
    } catch (err) {
      console.error(
        '⚠️ Kiosk markConverted: recordConversion failed:',
        (err as any)?.message || err,
      );
    }

    return true;
  }
}

export const kioskInviteService = new KioskInviteService();
export default kioskInviteService;
