import {
    onMessage,
    sendMessage,
    sendTyping,
    getMessageText,
    isFromMe,
    getSenderJid,
} from './services/whatsapp';
import { sendMessageWithMemory as sendGeminiMessage, clearConversation as clearGeminiConversation } from './services/gemini';
import { sendMessageWithMemory as sendZhipuMessage, clearConversation as clearZhipuConversation, detectBookingIntent } from './services/zhipu';
import { getRegistrationMessage, getPaymentMessage, getCVMessage } from './config/links-config';
import { handleBookingMessage, startBookingFlow, handleSpecificDateRequest } from './services/BookingService';
import { createServer } from 'http';

console.log('🤖 WhatsApp AI Bot starting...');

// Health check server for Render.com
const PORT = process.env.PORT || 8080;
const server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'whatsapp-bot' }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Health check server running on port ${PORT}`);
});

/**
 * Main message handler
 * Processes incoming messages and responds with AI
 */
onMessage(async (message) => {
    try {
        const jid = getSenderJid(message);
        const text = getMessageText(message);

        // Debug: Log incoming messages
        console.log(`📩 Message: "${text.substring(0, 50)}..." from ${jid}`);

        // Ignore messages from self
        if (isFromMe(message)) {
            console.log('   (Ignoring own message)');
            return;
        }

        // Ignore empty messages
        if (!text || text.trim() === '') {
            console.log('   (Ignoring empty message)');
            return;
        }

        // Ignore status broadcasts - only skip @broadcast addresses
        if (jid.includes('@broadcast')) {
            console.log('   (Ignoring broadcast message)');
            return;
        }

        // 1. Check if user is in a booking flow
        const handledByBooking = await handleBookingMessage(jid, text);
        if (handledByBooking) {
            console.log('   📅 Handled by BookingService');
            return;
        }

        // Handle commands starting with !
        if (text.startsWith('!')) {
            console.log(`   🤖 Processing command: ${text}`);
            await handleCommand(jid, text);
            return;
        }

        // For all other messages, respond with AI
        console.log('   💬 Processing as AI chat...');
        try {
            // Show typing indicator
            await sendTyping(jid);

            // 3. Check for natural language booking intent
            // This is "Tool Calling" via NLP
            // Note: If Gemini fails (IP Invalid), this returns null and we proceed to Zhipu
            const bookingIntent = await detectBookingIntent(text);
            if (bookingIntent && bookingIntent.intent === 'CHECK_AVAILABILITY' && bookingIntent.date && bookingIntent.time) {
                console.log(`   📅 Specific booking request: ${bookingIntent.date} @ ${bookingIntent.time}`);
                await handleSpecificDateRequest(jid, bookingIntent.date, bookingIntent.time);
                return;
            }

            // Get AI response (Using Zhipu/GLM as primary)
            const response = await sendZhipuMessage(jid, text);

            console.log('   📤 Sending AI response...');
            const sent = await sendMessage(jid, `🤖 ${response}`);

            if (sent) {
                console.log('   ✅ AI response sent');
            } else {
                console.log('   ❌ Failed to send response');
            }
        } catch (aiError: any) {
            console.error('   ❌ AI response error:', aiError.message || aiError);

            // Check for quota/rate limit errors
            const errorMsg = aiError.message || '';
            if (errorMsg.includes('429') || errorMsg.includes('quota')) {
                await sendMessage(
                    jid,
                    '⚠️ *API Quota Exceeded*\n\nPlease try again in a minute.'
                );
            } else {
                await sendMessage(
                    jid,
                    '⚠️ Sorry, I could not process your message.\nPlease try again or use `!help`'
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
async function handleCommand(jid: string, text: string): Promise<void> {
    const command = text.toLowerCase().split(' ')[0];

    switch (command) {
        case '!help':
            await sendMessage(
                jid,
                `🏗️ *Job Assist Bot (ජොබ් අසිස්ට්)*

*ඊශ්‍රායල ඉදිකිරීම් රැකියා විශේෂඥයා*

*Available Commands:*
• \`!help\` - උදව් ලබාගන්න
• \`!jobs\` - පවතින රැකියා ඇබෑර්තු
• \`!visit\` - පැමිණීමට වේලාවක් වෙන්කරගන්න
• \`!register\` - ලියාපදිංචි වන්න
• \`!payment\` - ගෙවීම් විස්තර ලබාගන්න
• \`!cv\` - CV submit කරන්න
• \`!clear\` - කතාබහ අලුතින් අරඹන්න

*ඔබට අවශ්‍ය දේ පණිවුඩයක් ලෙස එවන්න.*`
            );
            break;

        case '!ping':
            await sendMessage(jid, '🏓 Pong! Bot is online and ready.');
            break;

        case '!clear':
            clearGeminiConversation(jid);
            clearZhipuConversation(jid);
            await sendMessage(jid, '🗑️ කතාබහ ඉතිහාසය මකා දැමුවා!\nදැන් අලුතින් ආරම්භ කරමු! 🏗️');
            break;

        case '!register':
        case '!join':
        case '!apply':
            console.log('   📝 Sending registration form...');
            await sendMessage(jid, getRegistrationMessage());
            break;

        case '!payment':
        case '!pay':
        case '!bank':
            console.log('   💳 Sending payment details...');
            // Extract argument if exists (e.g., "!payment singapore" -> "singapore")
            const paymentArg = text.split(' ').slice(1).join(' ');
            await sendMessage(jid, getPaymentMessage(paymentArg));
            break;

        case '!cv':
            console.log('   📄 Sending CV submission form...');
            await sendMessage(jid, getCVMessage());
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

📝 ලියාපදිංචි වීමට \`!register\` භාවිතා කරන්න.`
            );
            break;

        case '!visit':
        case '!schedule':
        case '!appointment':
        case '!book':
            console.log('   📅 Starting booking flow...');
            await startBookingFlow(jid);
            break;

        default:
            await sendMessage(
                jid,
                `❓ Unknown command: \`${command}\`\n\nUse \`!help\` to see available commands.`
            );
    }
}
