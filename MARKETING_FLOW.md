# Marketing & Conversion Flow

How the bot converts a WhatsApp message into a booked customer, and how the
operator's **AI Personality** layer merges into both working types.

> The two "working types":
>
> - **Type A — Live conversation agents** (inbound, real-time): convert a chatting visitor.
> - **Type B — Automation / operator agents** (outbound, background): campaigns, segmentation, follow-up.
>
> After the 2026-06-06 fix, **both customer-facing paths apply your `AI_PERSONALITY`** (Admin Panel → Datasets → AI_PERSONALITY).

---

## 1. Inbound message flow — the two paths

```mermaid
flowchart TD
    MSG["📩 Customer message on WhatsApp"] --> PRE

    subgraph PRE["Pre-checks (src/index.ts)"]
        SEC["Security → Rate-limit"] --> FLOWS["Booking / Lead / Form flows"]
        FLOWS --> CMD["Commands (!book, !cv, !jobs)"]
    end

    PRE -->|none matched = normal chat| ORCH["AgentOrchestrator<br/>classifyIntent + canHandle"]

    ORCH -->|an agent handles it| P1
    ORCH -->|no agent handles it| P2

    subgraph P1["PATH 1 — Specialist Agent"]
        A1["agent.execute()"] --> A2["withOperatorPersona(persona + taskPrompt)"]
        A2 --> A3["sendMessageRaw → strict JSON"]
    end

    subgraph P2["PATH 2 — Legacy AI fallback"]
        B1["aiLoadBalancer.sendMessage"] --> B2["system = AI_PERSONALITY + knowledgeBase<br/>(refreshed every message)"]
    end

    P1 --> STYLE["enforceWhatsAppStyle()<br/>length cap + CTA guard"]
    P2 --> STYLE
    STYLE --> OUT["📤 Reply sent to customer"]

    style A2 fill:#1f7a3f,color:#fff
    style B2 fill:#1f7a3f,color:#fff
```

---

## 2. How the two layers merge (`withOperatorPersona`)

```mermaid
flowchart LR
    OP["OPERATOR LAYER<br/>AI_PERSONALITY dataset<br/>• brand voice / identity<br/>• tone & rules<br/>• multi-lang en/si/ta"]
    TASK["AGENT TASK LAYER<br/>e.g. DEAL_AGENT_V1_PROMPT<br/>• BANT / closing logic<br/>• output schema (JSON)"]

    OP --> MERGE
    TASK --> MERGE

    MERGE["MERGED SYSTEM PROMPT<br/>1. PERSONA first → governs VOICE<br/>2. TASK last → governs LOGIC + output"]

    style OP fill:#1f5f7a,color:#fff
    style MERGE fill:#1f7a3f,color:#fff
```

The persona shapes the **wording/tone**; the agent still performs its task and
returns its required JSON (task instructions stay last, so they remain salient).

---

## 3. The conversion funnel (Type A agents)

```mermaid
flowchart TD
    S["Stranger messages"] --> P["PersonalizationAgent<br/>warm greeting, open the door"]
    P --> L["LeadQualifierAgent<br/>BANT qualify + give value"]
    L --> D["DealAgent (closer)<br/>interested → confirmed visit"]
    D --> BOOK["📅 BookingService flow<br/>(free campus visit booked)"]
    L -. nurture / re-engage .-> C["ContentRecommenderAgent"]
    C -.-> L
```

---

## 4. The 5-step conversion playbook (applied on every conversation)

| Step | Name                  | What the bot does                                                      |
| ---- | --------------------- | ---------------------------------------------------------------------- |
| 1    | **CONNECT**           | Greet warmly in the customer's language, mirror tone                   |
| 2    | **UNDERSTAND**        | Ask ONE focused qualifying question (country/job/skills/timeline)      |
| 3    | **VALUE**             | Tie their goal to how you help — sell the outcome, never invent prices |
| 4    | **LOWER THE BARRIER** | Position the FREE, no-obligation campus visit as the next step         |
| 5    | **CALL TO ACTION**    | End with ONE easy CTA ("shall I check available dates?" / `!book`)     |

**Persuasion principles:** reciprocity · risk-reversal · commitment & consistency ·
social proof (only if true) · scarcity (only if true). **Never:** fake urgency,
invented prices/vacancies/testimonials, or pressure.

---

_Source: `src/index.ts`, `src/services/AgentOrchestrator.ts`, `src/agents/*`,
`src/agents/composeSystemPrompt.ts`, `src/config/companies/index.ts`._
