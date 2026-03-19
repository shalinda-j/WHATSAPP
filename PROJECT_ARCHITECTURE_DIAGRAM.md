# WhatsApp AI Bot - Complete Architecture Explanation

## Project Overview
The WhatsApp AI Bot is a comprehensive full-stack application designed to provide AI-powered customer interaction via WhatsApp. It features multi-AI provider load balancing, voice processing, NLP, CRM integration, and real-time communication capabilities.

## Core Components Breakdown

### 1. **Core Engine (src/index.ts)**
- Main application entry point
- Handles WhatsApp message processing
- Integrates all major services
- Manages graceful shutdown procedures

### 2. **Server Layer (Express.js)**
- RESTful API endpoints
- Authentication middleware
- WebSocket integration for real-time communication
- Database connection management

### 3. **Service Layer**
#### AI Load Balancer
- Distributes requests among multiple AI providers (Gemini, OpenAI, Groq, OpenRouter)
- Implements intelligent fallback mechanism
- Tracks usage and costs
- Manages conversation history

#### Natural Language Processing (NLP)
- Uses node-nlp for local intent recognition
- Self-learning capability from AI interactions
- Caches frequent queries for faster response
- Integrates with the AI system for continuous learning

#### Voice Processing
- Speech-to-text (STT) with multiple providers
- Text-to-speech (TTS) with various voices
- Multi-language support (Sinhala, English, Hindi, Tamil)
- Automatic language detection

#### Business Logic Services
- **Lead Service**: Handles lead registration and management
- **Booking Service**: Scheduling and appointment booking
- **CRM Service**: Customer relationship management
- **Webhook Service**: External system integration
- **Calendar Service**: Event scheduling and management

### 4. **Data Layer (MongoDB)**
- Configurable schemas for all data types
- Session management for WhatsApp connections
- Message history storage
- Lead and customer data
- NLP intent cache
- Configuration settings

### 5. **Client Layer (React)**
- Real-time dashboard
- Configuration management
- Conversation history
- Analytics and reporting
- Voice agent controls

## Data Flow

1. **Message Reception**: WhatsApp message arrives → Baileys processes → Sent to message handler
2. **Intent Recognition**: Check NLP cache → If miss, send to AI load balancer
3. **AI Processing**: AI provider generates response → Response cached for future use
4. **Response Delivery**: Format response → Send back via WhatsApp
5. **Learning Loop**: Interaction stored → Used to train NLP model

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   EXTERNAL SYSTEMS                                    │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │   WhatsApp      │    │   AI Providers  │    │   Third-party   │    │   Clients   │ │
│  │    Mobile       │    │  (Gemini, etc)  │    │    Services     │    │    Apps     │ │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────┘ │
└─────────────────┬─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               INBOUND MESSAGE PROCESSING                              │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │                        @whiskeysockets/baileys (WhatsApp API)                    │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                          │                                            │
│                                          ▼                                            │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │                           MESSAGE HANDLER LAYER                                  │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │   Voice     │  │  Commands   │  │   Leads     │  │   Booking   │           │ │
│  │  │  Processing │  │ Processing  │  │ Processing  │  │ Processing  │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────┬─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              CORE PROCESSING ENGINE                                   │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │                           MAIN APPLICATION (src/index.ts)                       │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                          │                                            │
│                                          ▼                                            │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              SERVICE LAYER                                        │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │ │
│  │  │   AI Load       │  │    NLP          │  │   Voice         │  │  Humanizer  │ │ │
│  │  │   Balancer      │  │    Service      │  │   Processing    │  │  Service    │ │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────┘ │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │ │
│  │  │   Booking       │  │    Lead         │  │   CRM           │  │  Security   │ │ │
│  │  │   Service       │  │    Service      │  │   Service       │  │  Service    │ │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────┘ │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │ │
│  │  │   Calendar      │  │   Webhook       │  │   Configuration │  │   Crypto    │ │ │
│  │  │   Service       │  │   Service       │  │   Service       │  │   Service   │ │ │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────┘ │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────┬─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA MANAGEMENT LAYER                                    │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │                                MONGODB DATABASE                                  │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │   Config    │  │  Voice      │  │   NLP       │  │   Chat      │           │ │
│  │  │   Model     │  │  Config     │  │   Cache     │  │   Message   │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │    Lead     │  │  Workflow   │  │   Webhook   │  │   Session   │           │ │
│  │  │   Model     │  │   Model     │  │   Model     │  │   Model     │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │   Admin     │  │    CRM      │  │   Dataset   │  │             │           │ │
│  │  │   Model     │  │   Model     │  │   Model     │  │             │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────┬─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                             API & COMMUNICATION LAYER                                 │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              EXPRESS SERVER                                       │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │    Auth     │  │   Config    │  │   Voice     │  │   WhatsApp  │           │ │
│  │  │   Routes    │  │   Routes    │  │   Routes    │  │   Routes    │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │   Bulk      │  │   Leads     │  │   CRM       │  │  Analytics  │           │ │
│  │  │   Routes    │  │   Routes    │  │   Routes    │  │   Routes    │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │  Sessions   │  │  Datasets   │  │   Webhook   │  │  Workflows  │           │ │
│  │  │   Routes    │  │   Routes    │  │   Routes    │  │   Routes    │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                          │                                            │
│                                          ▼                                            │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │                            SOCKET.IO REAL-TIME                                  │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────┬─────────────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               CLIENT INTERFACE LAYER                                  │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │                               REACT APPLICATION                                  │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │  Dashboard  │  │  Config     │  │   CRM/      │  │   Voice     │           │ │
│  │  │    Page     │  │   Page      │  │ Analytics   │  │  Agent Hub  │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │ │
│  │  │  Chat       │  │  Workflow   │  │   Bulk      │  │  Marketing  │           │ │
│  │  │ Interface   │  │  Builder    │  │  Sender     │  │  Manager    │           │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘           │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘

```

## Technical Stack

### Backend
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **WhatsApp API**: @whiskeysockets/baileys
- **AI Integration**: Multiple providers (Gemini, OpenAI, Groq, OpenRouter)

### Frontend
- **Framework**: React with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **Real-time**: Socket.io

### Key Features
- **Multi-AI Load Balancing**: Intelligent distribution across AI providers
- **NLP Learning**: Self-improving local NLP system
- **Voice Processing**: Multi-language STT/TTS support
- **Lead Management**: Automated lead registration and tracking
- **Booking System**: Appointment scheduling
- **CRM Integration**: Customer data management
- **Real-time Dashboard**: Live monitoring and control
- **Configurability**: Extensive configuration through admin panel

## Configuration Architecture
The system now uses a centralized ConfigurationManagerService that allows all previously hardcoded values to be managed through the admin panel via the datasets section. This includes humanizer settings, company information, booking configuration, job types, keywords, conversation examples, and AI personality settings.

This architecture provides a robust, scalable solution for WhatsApp-based AI interactions with extensive customization capabilities.