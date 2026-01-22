import {
    onMessage,
    sendMessage,
    sendTyping,
    getMessageText,
    isFromMe,
    getSenderJid,
} from './services/whatsapp';
import { sendMessageWithMemory, clearConversation } from './services/zhipu';
import { getRegistrationMessage, getPaymentMessage, getCVMessage } from './config/links-config';
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

            // Get AI response
            const response = await sendMessageWithMemory(jid, text);

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
                `🏗️ *ජොබ් අසිස්ට් - Job Assist Bot*\n\n` +
                `*ඊශ්‍රායල ඉදිකිරීම් රැකියා විශේෂඥයා*\n\n` +
                `*Commands:*\n` +
                `• \`!help\` - උදව්\n` +
                `• \`!jobs\` - පවතින රැකියා\n` +
                `• \`!register\` - ලියාපදිංචි වන්න 📝\n` +
                `• \`!payment\` - ගෙවීම් විස්තර 💳\n` +
                `• \`!cv\` - CV submit කරන්න 📄\n` +
                `• \`!clear\` - කතාබහ මකන්න\n\n` +
                `*ඕනෑම පණිවුඩයක් යවන්න:*\n` +
                `• රැකියා තොරතුරු\n` +
                `• ගාස්තු විස්තර\n` +
                `• සුදුසුකම් පරීක්ෂාව\n\n` +
                `Powered by Gemini AI 🧠`
            );
            break;

        case '!ping':
            await sendMessage(jid, '🏓 Pong! Bot is online and ready.');
            break;

        case '!clear':
            clearConversation(jid);
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
                `📋 *පවතින රැකියා ඇබෑර්තු:*\n\n` +
                `⚡ *Electricians* - 10 ක්\n` +
                `🛣️ *Asphalt Teams* - 2 Teams\n` +
                `🔧 *Plumbers* - 40 ක්\n` +
                `🚛 *Concrete Pump Drivers* - 30 ක්\n` +
                `🚜 *Excavator/JCB Operators*\n` +
                `🧹 *Heavy Duty Cleaners* - 15 ක්\n` +
                `🏠 *Gypsum/Tile Fixers* - 100 බැගින්\n\n` +
                `📝 ලියාපදිංචි වන්න: \`!register\`\n` +
                `ඔබේ trade එක කියන්න! 👷`
            );
            break;

        default:
            await sendMessage(
                jid,
                `❓ Unknown command: \`${command}\`\n\nUse \`!help\` to see available commands.`
            );
    }
}
