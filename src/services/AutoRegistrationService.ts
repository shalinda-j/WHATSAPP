import mongoose from 'mongoose';
import ChatMessage from '../models/ChatMessage';
import { extractRealPhone, isLidJid } from '../utils/jid';

// Lazy import to avoid circular deps
const getContact = () => {
  try {
    return mongoose.model('Contact');
  } catch {
    return null;
  }
};

/**
 * Auto-Registration Service
 * Automatically registers new WhatsApp users as contacts in the CRM system
 * when they send their first message.
 */
export class AutoRegistrationService {
  private registeredNumbers: Set<string> = new Set();

  /**
   * Check if a user is new and auto-register them if so.
   * Returns true if user was newly registered.
   */
  async checkAndRegister(
    userId: string,
    pushName?: string,
    sessionId?: string,
    realPhone?: string,
  ): Promise<boolean> {
    // Already checked this session (in-memory cache)
    if (this.registeredNumbers.has(userId)) return false;

    try {
      const Contact = getContact();
      if (!Contact) {
        this.registeredNumbers.add(userId);
        return false;
      }

      // Prefer the real phone resolved at ingest. `@lid` identifiers are
      // privacy IDs, not dialable phone numbers.
      const phone = realPhone ?? extractRealPhone(userId);
      const rawIdentifier = userId.replace(/^\+/, '');

      // Check if contact already exists in DB
      const existingClauses: Record<string, unknown>[] = [
        { whatsappNumber: userId },
        { whatsappId: userId },
        { 'customFields.rawWhatsappJid': rawIdentifier },
      ];
      if (phone) {
        existingClauses.push(
          { phone: `+${phone}` },
          { phone },
          { whatsappNumber: phone },
          { whatsappId: phone },
        );
      }
      const existing = await Contact.findOne({ $or: existingClauses });

      if (existing) {
        this.registeredNumbers.add(userId);
        return false;
      }

      // Check how many previous messages exist (only truly new users get welcome msg)
      const msgCount = await ChatMessage.countDocuments({ userId });
      const isFirstMessage = msgCount === 0;

      // Parse display name
      const displayTail = (phone || rawIdentifier.replace(/@.*/, '')).slice(-4);
      const fullName = pushName || `User ${displayTail}`;
      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] || fullName;
      const lastName = nameParts.slice(1).join(' ') || '';

      // Create CRM contact. Keep raw LIDs out of phone/whatsappNumber unless
      // a real phone is available; store the raw JID only as metadata.
      const contactData: Record<string, unknown> = {
        firstName,
        lastName,
        whatsappOptIn: true,
        source: 'whatsapp',
        type: 'lead',
        status: 'active',
        tags: ['auto-registered', isFirstMessage ? 'first-time' : 'returning'],
        notes: `Auto-registered from WhatsApp on ${new Date().toLocaleDateString()}`,
        sessionId,
        customFields: {
          rawWhatsappJid: rawIdentifier,
          identifierType: isLidJid(userId) ? 'lid' : 'phone',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      if (phone) {
        contactData.phone = `+${phone}`;
        contactData.whatsappNumber = phone;
        contactData.whatsappId = userId;
      }

      await Contact.create(contactData);

      this.registeredNumbers.add(userId);
      console.log(
        `✅ Auto-registered CRM contact: ${fullName} (${phone || rawIdentifier})`,
      );
      return isFirstMessage; // Return true only for truly new users (to send welcome msg)
    } catch (err: any) {
      if (!err?.message?.includes('duplicate') && err?.code !== 11000) {
        console.error('⚠️ Auto-registration error:', err?.message || err);
      }
      this.registeredNumbers.add(userId);
      return false;
    }
  }

  /**
   * Get welcome message based on detected language
   */
  getWelcomeMessage(name: string, language: 'en' | 'si' | 'ta' = 'en'): string {
    const firstName = name.split(/\s+/)[0];

    const messages: Record<string, string> = {
      en: `👋 Hello ${firstName}! Welcome!\n\nI'm your AI assistant powered by 360ai. I can help you with:\n✅ Answering your questions\n✅ Booking appointments\n✅ Providing information\n\nType *help* to see what I can do for you!`,
      si: `👋 ආයුබෝවන් ${firstName}! ඔබව සාදරයෙන් පිළිගනිමු!\n\nමම ඔබේ AI සහකාරයා. මට ඔබට සහාය කළ හැකි දේ:\n✅ ඔබේ ප්‍රශ්නවලට පිළිතුරු දෙන්න\n✅ හමුවීම් වෙන් කිරීම\n\n*help* ටයිප් කරන්න!`,
      ta: `👋 வணக்கம் ${firstName}! உங்களை வரவேற்கிறோம்!\n\nநான் உங்கள் AI உதவியாளர். நான் உதவக்கூடியவை:\n✅ உங்கள் கேள்விகளுக்கு பதில்\n✅ சந்திப்பு முன்பதிவு\n\n*help* என்று தட்டச்சு செய்யுங்கள்!`,
    };

    return messages[language] || messages.en;
  }

  /**
   * Clear in-memory cache (call on restart)
   */
  clearCache(): void {
    this.registeredNumbers.clear();
  }
}

export const autoRegistrationService = new AutoRegistrationService();
