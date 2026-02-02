
import { generateResponse, analyzeLeadIntent } from '../src/services/gemini';
import * as dotenv from 'dotenv';
dotenv.config();

async function runTest() {
    console.log("🚀 Starting Sales Bot Test...\n");

    const scenarios = [
        {
            name: "Scenario 1: General Inquiry (Should trigger Lead Qual)",
            input: "මට ජපන් රස්සාවක් හොයාගන්න ඕනේ."
        },
        {
            name: "Scenario 2: Heavy Machinery (JCETI - Should mention Training)",
            input: "Backhoe training එකක් කරන්න ඕනේ. විස්තර කියන්න."
        },
        {
            name: "Scenario 3: Singapore (Should mention SEC-K)",
            input: "සිංගප්පූරු යන්න Welder කෙනෙක් විදියට. මොනවද ඕනේ?"
        },
        {
            name: "Scenario 4: Israel (Should mention Skill Test / Experience)",
            input: "ඊශ්‍රායලයේ මේසන් වැඩට යන්න පුළුවන්ද?"
        },
        {
            name: "Scenario 5: Asking Price (Should trigger Campus Visit invite)",
            input: "මේකේ ගාණ කීයද?"
        }
    ];

    for (const scenario of scenarios) {
        console.log(`--- ${scenario.name} ---`);
        console.log(`User: ${scenario.input}`);

        // Test Response Generation
        const response = await generateResponse(scenario.input);
        console.log(`\nBot Response:\n${response}\n`);

        // Test Intent Analysis
        const analysis = await analyzeLeadIntent(scenario.input);
        console.log(`Analysis Result:`, JSON.stringify(analysis, null, 2));
        console.log("\n--------------------------------------------------\n");
    }
}

runTest();
