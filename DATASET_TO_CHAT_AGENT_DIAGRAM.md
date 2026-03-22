# Dataset to Chat Agent Connection Diagram

This document explains how the two main datasets sections directly connect to the chat bot.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              ADMIN PANEL (Frontend)                                      │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐          │
│  │   Datasets Page     │    │   Config Page       │    │   Forms Page        │          │
│  │                     │    │                     │    │                     │          │
│  │ • JOB_TYPES         │    │ • Company Info      │    │ • Form Templates    │          │
│  │ • COUNTRIES         │    │ • Booking Config    │    │ • Field Options     │          │
│  │ • EXPERIENCE_LEVELS │    │ • AI Personality    │    │                     │          │
│  │ • HELP_MESSAGE      │    │ • Knowledge Base    │    │                     │          │
│  │ • JOBS_MESSAGE      │    │                     │    │                     │          │
│  └─────────┬───────────┘    └─────────┬───────────┘    └─────────┬───────────┘          │
└────────────┼──────────────────────────┼──────────────────────────┼──────────────────────┘
             │                          │                          │
             │                          │                          │
             ▼                          ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              MONGODB DATABASE                                            │
│  ┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐          │
│  │    Dataset Model    │    │  Company Config     │    │  FormTemplate Model │          │
│  │                     │    │    (JSON Files)     │    │                     │          │
│  │ {key, content, ...} │    │                     │    │ {fields, options}   │          │
│  └─────────┬───────────┘    └─────────┬───────────┘    └─────────┬───────────┘          │
└────────────┼──────────────────────────┼──────────────────────────┼──────────────────────┘
             │                          │                          │
             │                          │                          │
             ▼                          ▼                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND SERVICES                                            │
│                                                                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                        ConfigService.ts                                          │    │
│  │  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐            │    │
│  │  │ getJobTypes()     │  │ getCountries()    │  │ getExperience()   │            │    │
│  │  │ getHelpMessage()  │  │ getJobsMessage()  │  │ getClearMessage() │            │    │
│  │  │ getPingMessage()  │  │ getStopMessage()  │  │ getStartMessage() │            │    │
│  │  │ getAIKnowledge()  │  │ getAIPersonality()│  │ getBookingConfig()│            │    │
│  │  └─────────┬─────────┘  └─────────┬─────────┘  └─────────┬─────────┘            │    │
│  └────────────┼────────────────────────┼────────────────────────┼────────────────────┘    │
│               │                        │                        │                          │
│               ▼                        ▼                        ▼                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐    │
│  │                   ConfigurationManagerService.ts                                 │    │
│  │                                                                                  │    │
│  │   • Caching layer (60s TTL)                                                      │    │
│  │   • Fallback handling                                                            │    │
│  │   • Validation & warnings for unconfigured values                                │    │
│  │                                                                                  │    │
│  └──────────────────────────────────────┬──────────────────────────────────────────┘    │
│                                         │                                               │
│  ┌──────────────────────────────────────┼──────────────────────────────────────────┐    │
│  │                        FormService.ts                                           │    │
│  │                                                                                  │    │
│  │   • getDynamicOptions(field) → fetches JOB_TYPES, COUNTRIES, EXPERIENCE_LEVELS  │    │
│  │   • validateFieldAnswer() → validates user input against dataset options        │    │
│  │   • getFieldPrompt() → generates prompts with dynamic options                   │    │
│  │                                                                                  │    │
│  └──────────────────────────────────────┬──────────────────────────────────────────┘    │
│                                         │                                               │
│  ┌──────────────────────────────────────┼──────────────────────────────────────────┐    │
│  │                        LeadService.ts                                           │    │
│  │                                                                                  │    │
│  │   • startLeadRegistration() → fetches jobTypes, countries, experienceLevels     │    │
│  │   • handleLeadMessage() → validates selections against dataset values           │    │
│  │                                                                                  │    │
│  └──────────────────────────────────────┬──────────────────────────────────────────┘    │
└─────────────────────────────────────────┼───────────────────────────────────────────────┘
                                          │
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              CHAT AGENT (index.ts)                                       │
│                                                                                          │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │                            Message Handler                                         │  │
│  │                                                                                    │  │
│  │   !help ───────► configurationManager.getHelpMessage()                            │  │
│  │   !jobs ───────► configurationManager.getJobsMessage()                            │  │
│  │   !ping ───────► configurationManager.getPingMessage()                            │  │
│  │   !clear ──────► configurationManager.getClearMessage()                           │  │
│  │   !stop ───────► configurationManager.getStopMessage()                            │  │
│  │   !start ──────► configurationManager.getStartMessage()                           │  │
│  │   !register ───► FormService.startFormSession() → getDynamicOptions()            │  │
│  │   unknown ─────► configurationManager.getUnknownCommandMessage()                  │  │
│  │                                                                                    │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
│                                          │                                               │
│                                          │                                               │
│                                          ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐  │
│  │                            AI Chat Handler                                         │  │
│  │                                                                                    │  │
│  │   • Uses AI_PERSONALITY from datasets                                             │  │
│  │   • Uses AI_KNOWLEDGE_BASE from datasets                                          │  │
│  │   • Uses CONVERSATION_EXAMPLES from datasets                                      │  │
│  │                                                                                    │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Dataset Keys and Their Usage

### Message Templates (category: 'messages')

| Dataset Key | Used In | Description |
|-------------|---------|-------------|
| `HELP_MESSAGE` | `!help` command | Title, subtitle, commands list, footer |
| `JOBS_MESSAGE` | `!jobs` command | Job listings with emoji, title, count |
| `CLEAR_MESSAGE` | `!clear` command | Conversation cleared notification |
| `PING_MESSAGE` | `!ping` command | Bot online confirmation |
| `STOP_MESSAGE` | `!stop` command | Auto-registration opt-out |
| `START_MESSAGE` | `!start` command | Auto-registration opt-in |
| `WELCOME_MESSAGE` | New user greeting | First-time user welcome |
| `UNKNOWN_COMMAND_MESSAGE` | Unknown commands | Error message with `{command}` placeholder |

### Configuration (category: 'config')

| Dataset Key | Used In | Description |
|-------------|---------|-------------|
| `JOB_TYPES` | Lead registration, Forms | Available job categories |
| `COUNTRIES` | Lead registration, Forms | Countries with flags for job placement |
| `EXPERIENCE_LEVELS` | Lead registration, Forms | Experience ranges with labels |
| `BOOKING_CONFIG` | `!visit` command | Campus visit booking settings |
| `BOOKING_KEYWORDS` | AI intent detection | Keywords for booking intent |
| `REGISTRATION_CONFIG` | Registration flow | Links and messages |
| `PAYMENT_CONFIG` | `!payment` command | Payment instructions |
| `CV_CONFIG` | `!cv` command | CV submission settings |
| `HUMANIZER_CONFIG` | Message timing | Typing delays, reactions |
| `COMPANY_INFO` | Multiple places | Company name, contact, address |

### AI Configuration (category: 'ai')

| Dataset Key | Used In | Description |
|-------------|---------|-------------|
| `AI_PERSONALITY` | AI system prompt | Bot personality and behavior |
| `AI_KNOWLEDGE_BASE` | AI system prompt | Business knowledge content |
| `CONVERSATION_EXAMPLES` | AI context | Example Q&A for training |

## Data Flow Example: User Registration

```
User: !register
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ index.ts → FormService.startFormSession()                        │
│                                                                   │
│   1. Get FormTemplate from database                               │
│   2. For each field with _dataSource:                            │
│      - job_type → configurationManager.getJobTypes()             │
│      - country → configurationManager.getCountries()             │
│      - experience → configurationManager.getExperienceLevels()   │
│   3. Build prompt with dynamic options                           │
│   4. Send to user                                                 │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
User: Selects option "1" (first job type)
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ FormService.validateFieldAnswer()                                │
│                                                                   │
│   1. Get dynamic options from datasets                           │
│   2. Convert "1" → options[0] (actual value)                     │
│   3. Store validated value in form data                          │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
User: Completes form → Lead saved to database
```

## Important Notes

1. **No Hardcoded Data**: All values come from datasets configured via Admin Panel
2. **Graceful Fallbacks**: If datasets are empty, services log warnings and return empty arrays
3. **Caching**: ConfigurationManagerService caches values for 60 seconds
4. **Dynamic Options**: Form fields with `_dataSource` fetch options at runtime
5. **Validation**: User selections are validated against actual dataset values

## Configuration Order

1. **Admin Panel** → Configure datasets via UI
2. **MongoDB** → Stores dataset documents
3. **ConfigService** → Reads from MongoDB
4. **ConfigurationManagerService** → Caches and provides to consumers
5. **FormService/LeadService** → Uses configuration for user interactions
6. **index.ts** → Sends messages with configured content