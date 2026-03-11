import {
  onMessage,
  sendMessage,
  sendTyping,
  getMessageText,
  isFromMe,
  getSenderJid,
  downloadWhatsAppAudio,
  sendVoiceMessage,
  connectToWhatsApp,
  disconnectWhatsApp,
} from './services/whatsapp';
import { connectToMongoDB } from './services/MongoAuthService';
import { seedAIProviders } from './services/AIProviderSeeder';
import { seedDatasets } from './services/DatasetSeeder';
import { transcribeAudio, generateSpeech } from './services/voice';
import { aiLoadBalancer } from './services/AILoadBalancer';
import { chatPersonality } from './services/ChatPersonality';
import { nlpService } from './services/NLPService';
import { analyzeLeadIntent } from './services/gemini';
import { WebhookService } from './services/WebhookService';
import { configService } from './services/ConfigService';
import {
  handleBookingMessage,
  startBookingFlow,
  handleSpecificDateRequest,
} from './services/BookingService';
import {
  handleLeadMessage,
  startLeadRegistration,
  isUserInLeadFlow,
} from './services/LeadService';
import app from './server/app';
import mongoose from 'mongoose';
import { commandDispatcher } from './app/utils/CommandDispatcher';
import './app/commands';
import ChatMessage from './models/ChatMessage';
import VoiceConfig from './models/VoiceConfig';

const PORT = process.env.PORT || 8080;
let server: any;

async function startServer() {
  // 1. Connect to Database
  if (process.env.MONGODB_URI) {
    try {
      await connectToMongoDB(process.env.MONGODB_URI);
      // Seed AI providers from .env into the Config collection
      await seedAIProviders();
      await seedDatasets();
      await nlpService.initializeNLP();
    } catch (dbErr) {
      console.error('❌ MongoDB Connection Failed. Server starting in LIMITED MODE.');
      console.error(dbErr);
    }
  } else {
    console.warn(
      '⚠️ No MONGODB_URI found. Some features (Admin Panel) may not work.',
    );
  }

  // 2. Start Admin API
  server = app.listen(PORT, () => {
    console.log(`🚀 Admin API Server running on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  });

  // 3. Connect to WhatsApp
  await connectToWhatsApp();
}

/**
 * SUCCESSFUL SHUTDOWN HANDLER
 * Prevents "Conflict" errors by ensuring the old session is dead before the new one starts.
 */
const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Closing connections gracefully...`);

  try {
    // 1. Close WhatsApp Socket
    console.log('   🔌 Disconnecting WhatsApp...');
    await disconnectWhatsApp();

    // 2. Close MongoDB
    if (mongoose.connection.readyState === 1) {
      console.log('   🍃 Closing MongoDB...');
      await mongoose.connection.close();
    }

    // 3. Close Server
    if (server) {
      console.log('   🔒 Closing HTTP Server...');
      server.close();
    }

    console.log('✅ Shutdown complete. Exiting.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error during shutdown:', err);
    process.exit(1);
  }
};

// Handle process termination signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle ts-node-dev restart signal
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

startServer();

/**
 * Main message handler
 * Processes incoming messages and responds with AI
 */
onMessage(async (message, sock, sessionId) => {
  try {
    const jid = getSenderJid(message);
    let text = getMessageText(message);

    // Debug: Log incoming messages
    console.log(`📩 Message: "${text.substring(0, 50)}..." from ${jid}`);

    // Ignore messages from self
    if (isFromMe(message)) {
      console.log('   (Ignoring own message)');
      return;
    }

    // Helper to extract audio message from various wrappers
    const getAudioMessage = (msg: any) => {
      if (!msg) return null;
      return (
        msg.audioMessage ||
        msg.ephemeralMessage?.message?.audioMessage ||
        msg.viewOnceMessage?.message?.audioMessage ||
        msg.viewOnceMessageV2?.message?.audioMessage ||
        msg.documentWithCaptionMessage?.message?.audioMessage
      );
    };

    const audioMsg = getAudioMessage(message.message);

    // Ignore empty messages (unless it's a voice message)
    if ((!text || text.trim() === '') && !audioMsg) {
      console.log('   (Ignoring empty message)');
      return;
    }

    // Ignore status broadcasts - only skip @broadcast addresses
    if (jid.includes('@broadcast')) {
      console.log('   (Ignoring broadcast message)');
      return;
    }

    let messageType: 'text' | 'voice' = 'text';

    // Helper to extract audio message from various wrappers


    // Check for Audio Message
    let isVoiceMessage = false;
    if (audioMsg) {
      messageType = 'voice';
      console.log('   🎤 Voice message detected! Downloading...');
      const audioBuffer = await downloadWhatsAppAudio(message);

      if (audioBuffer) {
        try {
          // 1. Transcribe
          const transcription = await transcribeAudio(audioBuffer);
          console.log(`   📝 Transcription: "${transcription}"`);
          text = transcription;
          isVoiceMessage = true;
        } catch (err: any) {
          console.error('   ❌ Transcription failed:', err);
          await sendMessage(
            jid,
            '⚠️ Voice transcription failed. Please try text.',
            sessionId,
          );
          return;
        }
      } else {
        console.error('   ❌ Failed to download audio');
        return;
      }
    }

    // [NEW] 1. Save USER Message to DB
    try {
      const savedMsg = await ChatMessage.create({
        userId: jid,
        role: 'user',
        type: messageType,
        content: text,
        metadata: {
          sessionId,
          isBooking: false,
        },
      });

      // [NEW] Trigger Webhook for incoming message
      WebhookService.triggerWebhook('message.received', {
        id: savedMsg._id,
        from: jid,
        type: messageType,
        content: text,
        sessionId,
        timestamp: new Date(),
      });
    } catch (dbErr) {
      console.error('   ❌ Failed to save user message:', dbErr);
    }

    // 1. Check if user is in a booking flow
    const handledByBooking = await handleBookingMessage(jid, text, sessionId);
    if (handledByBooking) {
      console.log('   📅 Handled by BookingService');
      return;
    }

    // 2. Check if user is in lead registration flow
    const handledByLead = await handleLeadMessage(jid, text, sessionId);
    if (handledByLead) {
      console.log('   📝 Handled by LeadService');
      return;
    }

    // Handle commands starting with !
    if (text.startsWith('!')) {
      console.log(`   🤖 Processing command: ${text}`);
      await handleCommand(jid, text, sessionId, message);
      return;
    }

    // For all other messages, respond with AI
    console.log('   💬 Processing as AI chat...');
    try {
      // Show typing indicator
      await sendTyping(jid, sessionId);

      // 3. New Lead & Intent Analysis
      // Only check if message contains date/time related keywords (performance optimization)
      const bookingKeywords = [
        'tomorrow',
        'today',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
        'am',
        'pm',
        'morning',
        'afternoon',
        'evening',
        'visit',
        'appointment',
        'schedule',
        'book',
        'meet',
        'හෙට',
        'අද',
        'පැමිණ',
        'හමුවීම',
        'වේලාව',
      ];
      const hasBookingKeyword = bookingKeywords.some((keyword) =>
        text.toLowerCase().includes(keyword),
      );

      if (hasBookingKeyword) {
        const leadAnalysis = await analyzeLeadIntent(text);
        if (
          leadAnalysis &&
          leadAnalysis.intent === 'Check Availability' &&
          leadAnalysis.bookingDetails?.date &&
          leadAnalysis.bookingDetails?.time
        ) {
          console.log(
            `   📅 Specific booking request: ${leadAnalysis.bookingDetails.date} @ ${leadAnalysis.bookingDetails.time}`,
          );
          await handleSpecificDateRequest(
            jid,
            leadAnalysis.bookingDetails.date,
            leadAnalysis.bookingDetails.time,
            sessionId,
          );
          return;
        }
      }

      // Get AI response (Using Load Balancer)
      let response: string | undefined;
      let intentAnalysis: any = null;
      let answeredViaNLP = false;

      try {
        // Analyze Intent first for metadata
        intentAnalysis = await analyzeLeadIntent(text);

        // LANGUAGE DETECTION: Detect language and set response language accordingly
        // Default language is SINHALA. If user writes in English only, reply in English.
        let finalPrompt = text;
        if (isVoiceMessage) {
          const looksLikeEnglish = /^([a-zA-Z]+\s*){3,}$/.test(text.trim()) &&
            /\b(the|is|are|I|you|he|she|we|they|my|your|it|and|or|but|what|how|can|could|please|hello|hi|thank|yes|no|okay|ok)\b/i.test(text);
          const hasSinhalaChars = /[\u0D80-\u0DFF]/.test(text);
          const hasTamilChars = /[\u0B80-\u0BFF]/.test(text);

          if (hasSinhalaChars) {
            finalPrompt += `\n\n(SYSTEM: මෙය VOICE පණිවිඩයකි. සිංහල භාෂාවෙන් කෙටිව, ස්වාභාවිකව ප්‍රතිඋත්තර දෙන්න.)`;
          } else if (hasTamilChars) {
            finalPrompt += `\n\n(SYSTEM: இது குரல் செய்தி. தமிழில் சுருக்கமாக, இயல்பாக பதிலளிக்கவும்.)`;
          } else if (looksLikeEnglish) {
            finalPrompt += `\n\n(SYSTEM: This is a VOICE message in English. Reply ONLY in English, short and natural.)`;
          } else {
            finalPrompt += `\n\n(SYSTEM: මෙය VOICE පණිවිඩයකි. සිංහල භාෂාවෙන් කෙටිව ප්‍රතිඋත්තර දෙන්න.)`;
          }
        } else {
          // Text message: detect language
          const hasSinhala = /[\u0D80-\u0DFF]/.test(text);
          const isLikelyEnglish = /^[a-zA-Z0-9\s\p{P}!?.,;&'"()+\-*#@%$^\[\]{}|\\/<>=`~]+$/u.test(text.trim());

          if (hasSinhala) {
            // Message contains Sinhala → reply in Sinhala
            finalPrompt += `\n\n(SYSTEM: සිංහල භාෂාවෙන් ප්‍රතිඋත්තර දෙන්න.)`;
          } else if (isLikelyEnglish) {
            // Pure English message → reply in English
            finalPrompt += `\n\n(SYSTEM: The user is writing in English. Reply ONLY in English.)`;
          } else {
            // Unknown/other language → default to Sinhala (the system's default language)
            finalPrompt += `\n\n(SYSTEM: Default language is Sinhala. සිංහල භාෂාවෙන් ප්‍රතිඋත්තර දෙන්න.)`;
          }
        }

        // 4. Local NLP Interception
        const isLocalNLPEnabled = await configService.getLocalNLPEnabled();
        if (isLocalNLPEnabled) {
          const nlpCacheResponse = await nlpService.processMessage(text);
          if (nlpCacheResponse) {
            response = nlpCacheResponse;
            answeredViaNLP = true;
            console.log('   ✅ Answered via Local NLP Cache');
          }
        }

        // 5. Fallback to AI Load Balancer if NLP doesn't know the answer
        if (!response) {
          response = await aiLoadBalancer.sendMessage(jid, finalPrompt);

          // Learn from AI response dynamically (Fire & Forget)
          if (isLocalNLPEnabled && response && response.trim() !== '') {
            nlpService.learnFromAI(text, response).catch(err => {
              console.error('Failed to learn from AI:', err);
            });
          }
        }

        // Simulate realistic typing delay
        const typingDelay = chatPersonality.getTypingDelay(response ? response.length : 0);
        await new Promise(resolve => setTimeout(resolve, typingDelay));
      } catch (aiError: any) {
        console.error('   ❌ Error in AI/NLP processing:', aiError);
        throw aiError;
      }

      console.log('   📤 Sending AI response...');

      // Check if response is empty and provide fallback
      if (!response || response.trim() === '') {
        await sendMessage(
          jid,
          '🙏 කරුණාකර නැවත උත්සාහ කරන්න. ඔබේ ප්‍රශ්නය මට තේරුම් ගන්න බැරි විය.',
          sessionId,
        );
        console.log('   ⚠️ Empty response from AI, sent fallback message');
        return;
      }

      // [NEW] 2. Save BOT Response to DB
      try {
        await ChatMessage.create({
          userId: jid,
          role: 'assistant',
          type: 'text',
          content: response,
          metadata: {
            sessionId,
            intent: intentAnalysis?.intent || 'General',
            buyingSignal: intentAnalysis?.buyingSignal || 'None',
          },
        });
      } catch (dbErr) {
        console.error('   ❌ Failed to save bot response:', dbErr);
      }

      if (isVoiceMessage) {
        // Fetch Voice Config to respect the response mode
        // Default is 'voice-only' - when someone sends a voice note, reply with a voice note ONLY
        const voiceConfig = await VoiceConfig.findOne().sort({ updatedAt: -1 });
        const responseMode = voiceConfig?.mode || 'voice-only';
        let sentText = false;

        // If mode requires text, send it first
        if (responseMode === 'text-only' || responseMode === 'voice-and-text') {
          sentText = await sendMessage(jid, response, sessionId);
          console.log('   ✅ AI text response sent (based on mode)');
        }

        // If mode requires voice, generate and send it
        if (responseMode === 'voice-only' || responseMode === 'voice-and-text') {
          try {
            console.log('   🗣️ Generating voice response...');
            const audioResponse = await generateSpeech(response);
            await sendVoiceMessage(jid, audioResponse, sessionId);
            console.log('   ✅ AI voice response sent (based on mode)');
          } catch (ttsError) {
            console.error('   ❌ TTS failed:', ttsError);
            // Fallback if we didn't already send text
            if (!sentText) {
              await sendMessage(jid, response, sessionId);
            }
          }
        }
      } else {
        const sent = await sendMessage(jid, response, sessionId);
        if (sent) {
          console.log('   ✅ AI response sent');
        } else {
          console.log('   ❌ Failed to send response');
        }
      }
    } catch (aiError: any) {
      console.error('   ❌ AI response error:', aiError.message || aiError);

      // Check for quota/rate limit errors
      const errorMsg = aiError.message || '';
      if (errorMsg.includes('429') || errorMsg.includes('quota')) {
        await sendMessage(
          jid,
          '⚠️ *API Quota Exceeded*\n\nPlease try again in a minute.',
          sessionId,
        );
      } else {
        await sendMessage(
          jid,
          '⚠️ Sorry, I could not process your message.\nPlease try again or use `!help`',
          sessionId,
        );
      }
    }
  } catch (error) {
    console.error('❌ Message handling error:', error);
  }
});

/**
 * Handle bot commands
 */
async function handleCommand(
  jid: string,
  text: string,
  sessionId: string,
  message: any,
): Promise<void> {
  const command = text.toLowerCase().split(' ')[0];

  // 1. Try to use the Command Dispatcher (for new class-based commands)
  const commandName = command.slice(1); // Remove '!'
  if (commandDispatcher.hasCommand(commandName)) {
    const args = text.split(' ').slice(1);
    await commandDispatcher.dispatch(commandName, message, args, sessionId);
    return;
  }

  // 2. Fallback to manual switch (legacy/script commands)
  switch (command) {
    case '!help':
      await sendMessage(
        jid,
        `🏗️ *Jayalath Global AI (ජයලත් ග්ලොබල් AI)*

*ඊශ්‍රායල ඉදිකිරීම් රැකියා විශේෂඥයා*

*Available Commands:*
• \`!help\` - උදව් ලබාගන්න
• \`!jobs\` - පවතින රැකියා ඇබෑර්තු
• \`!visit\` - පැමිණීමට වේලාවක් වෙන්කරගන්න
• \`!register\` - ලියාපදිංචි වන්න
• \`!payment\` - ගෙවීම් විස්තර ලබාගන්න
• \`!cv\` - CV submit කරන්න
• \`!clear\` - කතාබහ අලුතින් අරඹන්න

*ඔබට අවශ්‍ය දේ පණිවුඩයක් ලෙස එවන්න.*`,
        sessionId,
      );
      break;

    case '!ping':
      await sendMessage(jid, '🏓 Pong! Bot is online and ready.', sessionId);
      break;

    case '!clear':
      aiLoadBalancer.clearConversation(jid);
      await sendMessage(
        jid,
        '🗑️ කතාබහ ඉතිහාසය මකා දැමුවා!\nදැන් අලුතින් ආරම්භ කරමු! 🏗️',
        sessionId,
      );
      break;

    case '!register':
    case '!join':
    case '!apply':
      console.log('   📝 Starting lead registration flow...');
      await startLeadRegistration(jid, sessionId);
      break;

    case '!payment':
    case '!pay':
    case '!bank':
      console.log('   💳 Sending payment details...');
      // Extract argument if exists (e.g., "!payment singapore" -> "singapore")
      const paymentArg = text.split(' ').slice(1).join(' ');
      await sendMessage(
        jid,
        await configService.getPaymentMessage(paymentArg),
        sessionId,
      );
      break;

    case '!cv':
      console.log('   📄 Sending CV submission form...');
      await sendMessage(jid, await configService.getCVMessage(), sessionId);
      break;

    case '!jobs':
      await sendMessage(
        jid,
        `📋 *පවතින රැකියා ඇබෑර්තු:*

⚡ *Electricians* - 10 ක්
🛣️ *Asphalt Teams* - 2 Teams
🔧 *Plumbers* - 40 ක්
🚛 *Concrete Pump Drivers* - 30 ක්
🚜 *Excavator/JCB Operators*
🧹 *Heavy Duty Cleaners* - 15 ක්
🏠 *Gypsum/Tile Fixers* - 100 බැගින්

📝 ලියාපදිංචි වීමට \`!register\` භාවිතා කරන්න.`,
        sessionId,
      );
      break;

    case '!visit':
    case '!schedule':
    case '!appointment':
    case '!book':
      console.log('   📅 Starting booking flow...');
      await startBookingFlow(jid, sessionId);
      break;

    default:
      await sendMessage(
        jid,
        `❓ Unknown command: \`${command}\`\n\nUse \`!help\` to see available commands.`,
        sessionId,
      );
  }
}
