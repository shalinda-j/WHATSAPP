import { sendMessageWithMemory } from './services/zhipu';
import dotenv from 'dotenv';
dotenv.config();

async function runConcurrencyTest() {
    console.log('🚀 Starting Multi-User Concurrency Test...');
    console.log('-------------------------------------------');

    const users = [
        { id: 'user_1', question: 'What is 10 + 10? Answer only the number.' },
        { id: 'user_2', question: 'What is the capital of France? Answer only the city name.' },
        { id: 'user_3', question: 'Say "Hello" in Sinhala.' }
    ];

    const startTime = Date.now();

    // Map each user to a promise (API call)
    const promises = users.map(async (user) => {
        console.log(`[${user.id}] Sending: "${user.question}"`);
        const response = await sendMessageWithMemory(user.id, user.question);
        const endTime = Date.now();
        console.log(`[${user.id}] ✅ Received: "${response}" (Time: ${(endTime - startTime) / 1000}s)`);
        return {
            id: user.id,
            question: user.question,
            response,
            time: (endTime - startTime) / 1000
        };
    });

    // Wait for all to finish
    await Promise.all(promises);

    const totalTime = (Date.now() - startTime) / 1000;
    console.log('-------------------------------------------');
    console.log(`🏁 All requests completed in ${totalTime} seconds.`);

    // Validation Logic
    if (totalTime < 8) { // Assuming 3 requests sequentially would take > 8-10s
        console.log('✅ PASS: Concurrency detected (Total time is low).');
    } else {
        console.log('⚠️ WARNING: Might be running sequentially.');
    }
}

runConcurrencyTest().catch(console.error);
