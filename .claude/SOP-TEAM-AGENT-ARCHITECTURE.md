# SOP Team Agent Architecture Framework

## Overview

This document defines the Standard Operating Procedures (SOP) for the Team Agent Architecture used in developing and maintaining the WhatsApp AI Bot project. It establishes roles, responsibilities, coordination patterns, and implementation guidelines for effective multi-agent collaboration.

---

## 1. Agent Architecture Overview

### 1.1 Architecture Philosophy

The Team Agent Architecture follows a **hierarchical orchestration model** with clear role separation:

```
┌─────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR AGENT                         │
│                    (Team Lead / Coordinator)                    │
│                                                                 │
│  Responsibilities:                                              │
│  - Task decomposition and assignment                            │
│  - Progress monitoring and coordination                         │
│  - Quality assurance and integration                            │
│  - Conflict resolution                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   RESEARCHER  │     │   DEVELOPER   │     │    TESTER     │
│     AGENT     │     │     AGENT     │     │     AGENT     │
├───────────────┤     ├───────────────┤     ├───────────────┤
│ - Codebase    │     │ - Backend     │     │ - Unit tests  │
│   exploration │     │   development │     │ - Integration │
│ - Documentation│    │ - Frontend    │     │   tests       │
│   analysis    │     │   development │     │ - E2E tests   │
│ - Best        │     │ - API         │     │ - Performance │
│   practices   │     │   integration │     │   testing     │
│ - Web search  │     │ - Database    │     │ - Quality     │
│   & research  │     │   operations  │     │   assurance   │
└───────────────┘     └───────────────┘     └───────────────┘
```

### 1.2 Agent Types Definition

| Agent Type | Role | Tools Access | Primary Responsibilities |
|------------|------|--------------|-------------------------|
| **Orchestrator** | Team Lead | All tools | Coordination, task assignment, integration |
| **Researcher** | Explorer | Read, Grep, Glob, WebFetch, WebSearch | Analysis, documentation, best practices |
| **Developer** | Implementer | Read, Edit, Write, Bash | Code implementation, feature development |
| **Tester** | QA | Read, Edit, Bash, Task tools | Testing, validation, quality assurance |
| **Planner** | Architect | Read, Grep, Glob | Design, planning, documentation |

---

## 2. Standard Operating Procedures (SOP)

### 2.1 SOP-001: Feature Development Workflow

**Objective**: Implement new features with proper planning, development, and testing.

**Procedure**:

```
Phase 1: Planning (Planner Agent)
├── 1.1 Analyze requirements and existing codebase
├── 1.2 Design implementation approach
├── 1.3 Create task breakdown with dependencies
├── 1.4 Document in PLAN.md file
└── 1.5 Submit for approval

Phase 2: Development (Developer Agent)
├── 2.1 Read approved plan
├── 2.2 Implement features following patterns
├── 2.3 Write/update tests
├── 2.4 Document changes
└── 2.5 Submit for review

Phase 3: Testing (Tester Agent)
├── 3.1 Review implemented changes
├── 3.2 Execute test suite
├── 3.3 Validate against requirements
├── 3.4 Report issues or approve
└── 3.5 Update documentation

Phase 4: Integration (Orchestrator)
├── 4.1 Review all outputs
├── 4.2 Resolve conflicts
├── 4.3 Final integration
└── 4.4 Deployment preparation
```

### 2.2 SOP-002: Bug Fix Workflow

**Objective**: Efficiently identify, diagnose, and fix bugs.

**Procedure**:

```
Phase 1: Triage (Researcher Agent)
├── 1.1 Reproduce the issue
├── 1.2 Identify affected components
├── 1.3 Document error logs and stack traces
├── 1.4 Assess severity and priority
└── 1.5 Create bug report

Phase 2: Diagnosis (Researcher + Developer)
├── 2.1 Trace code execution path
├── 2.2 Identify root cause
├── 2.3 Propose fix approach
└── 2.4 Document findings

Phase 3: Fix Implementation (Developer Agent)
├── 3.1 Implement fix
├── 3.2 Add/update tests
├── 3.3 Verify fix works
└── 3.4 Document changes

Phase 4: Validation (Tester Agent)
├── 4.1 Verify bug is fixed
├── 4.2 Regression testing
├── 4.3 Performance validation
└── 4.4 Sign-off
```

### 2.3 SOP-003: Code Review Process

**Objective**: Maintain code quality through systematic review.

**Checklist**:
- [ ] Code follows project patterns and conventions
- [ ] TypeScript types are properly defined
- [ ] Error handling is comprehensive
- [ ] Tests cover new functionality
- [ ] Documentation is updated
- [ ] No security vulnerabilities introduced
- [ ] Performance considerations addressed

### 2.4 SOP-004: Database Schema Changes

**Objective**: Safely modify database schemas.

**Procedure**:
1. **Research**: Analyze existing schema and dependencies
2. **Design**: Create migration strategy
3. **Implement**: Add new fields/models with backward compatibility
4. **Test**: Verify data integrity and query performance
5. **Document**: Update model documentation

---

## 3. Agent Role Specifications

### 3.1 Orchestrator Agent (Team Lead)

**Responsibilities**:
- Decompose complex tasks into subtasks
- Assign tasks to appropriate agents
- Monitor progress and handle blockers
- Integrate outputs from multiple agents
- Make final decisions on conflicts

**Decision Authority**:
- Task prioritization
- Resource allocation
- Architecture decisions
- Release approval

**Communication Pattern**:
```
Orchestrator → Broadcast: "Starting feature X development"
Orchestrator → Researcher: "Analyze requirements for feature X"
Researcher → Orchestrator: "Analysis complete, plan ready"
Orchestrator → Developer: "Implement feature X per plan"
Developer → Orchestrator: "Implementation complete"
Orchestrator → Tester: "Validate feature X implementation"
Tester → Orchestrator: "Tests passed, approved"
```

### 3.2 Researcher Agent (Explorer)

**Responsibilities**:
- Explore and understand codebase structure
- Research best practices and patterns
- Gather requirements and constraints
- Document findings and recommendations
- Perform web research for solutions

**Output Artifacts**:
- Analysis documents
- Code maps and diagrams
- Best practice recommendations
- Research summaries

**Key Skills**:
- Deep codebase exploration
- Pattern recognition
- Documentation synthesis
- External research integration

### 3.3 Developer Agent (Implementer)

**Responsibilities**:
- Implement features following specifications
- Write clean, maintainable code
- Follow established patterns and conventions
- Create and update tests
- Document implementation details

**Coding Standards**:
- TypeScript with proper typing
- Follow existing code patterns
- Handle errors appropriately
- Write self-documenting code
- Add comments for complex logic

**File Modification Protocol**:
1. Read existing file completely
2. Understand context and patterns
3. Make minimal necessary changes
4. Verify syntax and types
5. Test changes locally

### 3.4 Tester Agent (QA)

**Responsibilities**:
- Execute test suites
- Validate against requirements
- Identify edge cases
- Performance testing
- Quality assurance reporting

**Testing Matrix**:
| Test Type | Scope | Tools |
|-----------|-------|-------|
| Unit Tests | Individual functions | Jest |
| Integration Tests | API endpoints | Jest + Supertest |
| E2E Tests | Full workflows | Playwright |
| Performance Tests | Load, stress | k6, Artillery |

### 3.5 Planner Agent (Architect)

**Responsibilities**:
- Design system architecture
- Create implementation plans
- Define technical specifications
- Identify dependencies and risks
- Document design decisions

**Planning Artifacts**:
- Architecture diagrams
- Implementation plans
- Technical specifications
- Risk assessments
- Timeline estimates

---

## 4. Coordination Mechanisms

### 4.1 Task Assignment Protocol

```typescript
// Task creation with clear specifications
TaskCreate({
  subject: "Implement voice transcription fallback",
  description: `
    ## Objective
    Add fallback mechanism when primary STT provider fails.

    ## Requirements
    - Try OpenAI Whisper first
    - Fall back to Gemini if OpenAI fails
    - Log all failures for monitoring

    ## Files to Modify
    - src/services/voice.ts

    ## Acceptance Criteria
    - [ ] Both providers attempted on failure
    - [ ] Error logging implemented
    - [ ] Unit tests added
  `,
  activeForm: "Implementing voice transcription fallback"
});
```

### 4.2 Progress Tracking

```
Task States:
├── pending      → Waiting to be started
├── in_progress  → Currently being worked on
├── blocked      → Waiting on dependency
├── review       → Awaiting review
├── completed    → Successfully finished
└── deleted      → No longer needed
```

### 4.3 Dependency Management

```typescript
// Setting up task dependencies
TaskUpdate({
  taskId: "2",
  addBlockedBy: ["1"]  // Task 2 cannot start until Task 1 is complete
});

TaskUpdate({
  taskId: "1",
  addBlocks: ["2", "3"]  // Task 1 blocks Tasks 2 and 3
});
```

### 4.4 Communication Protocol

**Message Types**:
1. **Status Updates**: Progress reports to orchestrator
2. **Requests**: Asking for help or clarification
3. **Handoffs**: Transferring work between agents
4. **Alerts**: Critical issues requiring attention

**Message Format**:
```
[AGENT_TYPE] [ACTION] [TARGET]

Examples:
[DEVELOPER] [COMPLETE] Task #5 implementation
[TESTER] [FAIL] Test suite failed - 3 errors
[RESEARCHER] [READY] Analysis complete for feature X
[ORCHESTRATOR] [ASSIGN] Task #6 to Developer
```

---

## 5. Implementation Guidelines

### 5.1 Agent Configuration

```json
// .claude/agents/custom-agent.json
{
  "name": "whatsapp-specialist",
  "description": "Specialized agent for WhatsApp integration tasks",
  "model": "sonnet",
  "tools": ["Read", "Edit", "Write", "Bash"],
  "systemPrompt": "You are a WhatsApp API specialist...",
  "capabilities": [
    "Baileys library integration",
    "Message processing",
    "Session management"
  ]
}
```

### 5.2 Team Configuration

```json
// .claude/teams/development-team.json
{
  "team_name": "whatsapp-bot-dev",
  "description": "Development team for WhatsApp AI Bot",
  "members": [
    {
      "name": "team-lead",
      "agentType": "general-purpose",
      "role": "orchestrator"
    },
    {
      "name": "researcher",
      "agentType": "Explore",
      "role": "analyst"
    },
    {
      "name": "developer",
      "agentType": "general-purpose",
      "role": "implementer"
    },
    {
      "name": "tester",
      "agentType": "general-purpose",
      "role": "qa"
    }
  ]
}
```

### 5.3 Workflow Templates

#### Feature Development Workflow
```yaml
name: Feature Development
steps:
  - agent: planner
    action: create_plan
    outputs: [plan_document]

  - agent: developer
    action: implement
    inputs: [plan_document]
    outputs: [code_changes]

  - agent: tester
    action: validate
    inputs: [code_changes]
    outputs: [test_results]

  - agent: orchestrator
    action: integrate
    inputs: [code_changes, test_results]
    outputs: [release_candidate]
```

#### Bug Fix Workflow
```yaml
name: Bug Fix
steps:
  - agent: researcher
    action: diagnose
    outputs: [bug_report]

  - agent: developer
    action: fix
    inputs: [bug_report]
    outputs: [fix_changes]

  - agent: tester
    action: verify
    inputs: [fix_changes]
    outputs: [verification_report]
```

---

## 6. Quality Assurance Framework

### 6.1 Code Quality Standards

**TypeScript Requirements**:
- All functions must have explicit return types
- No `any` types without justification
- Proper error handling with typed errors
- Interface-first design for APIs

**Testing Requirements**:
- Unit tests for all business logic
- Integration tests for API endpoints
- Minimum 80% code coverage
- Performance benchmarks for critical paths

**Documentation Requirements**:
- JSDoc for public APIs
- README updates for new features
- Architecture diagrams for major changes
- Migration guides for breaking changes

### 6.2 Review Checklists

**Code Review Checklist**:
```markdown
- [ ] Code compiles without errors
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] Follows project patterns
- [ ] Error handling implemented
- [ ] Documentation updated
- [ ] No security issues
- [ ] Performance acceptable
```

**Security Review Checklist**:
```markdown
- [ ] Input validation present
- [ ] No SQL injection vulnerabilities
- [ ] No XSS vulnerabilities
- [ ] API keys not hardcoded
- [ ] Authentication checks in place
- [ ] Rate limiting implemented
- [ ] Sensitive data encrypted
```

### 6.3 Performance Benchmarks

| Metric | Target | Measurement |
|--------|--------|-------------|
| API Response Time | < 200ms | P95 latency |
| Message Processing | < 500ms | End-to-end |
| AI Response Generation | < 3s | First token |
| Database Queries | < 50ms | P95 latency |
| Memory Usage | < 512MB | Peak usage |

---

## 7. Error Handling & Escalation

### 7.1 Error Categories

| Level | Description | Response Time | Escalation |
|-------|-------------|---------------|------------|
| P1 - Critical | System down | Immediate | Orchestrator |
| P2 - High | Feature broken | < 1 hour | Team Lead |
| P3 - Medium | Degraded performance | < 4 hours | Developer |
| P4 - Low | Minor issues | < 24 hours | Any agent |

### 7.2 Escalation Protocol

```
Agent encounters blocker
        │
        ▼
┌───────────────────┐
│ Log issue details │
└───────────────────┘
        │
        ▼
┌───────────────────┐     Yes    ┌───────────────────┐
│ Can resolve alone?│───────────▶│ Resolve and       │
└───────────────────┘            │ continue          │
        │ No                     └───────────────────┘
        ▼
┌───────────────────┐
│ Notify Orchestrator│
│ with details       │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│ Orchestrator      │
│ assigns resources │
└───────────────────┘
```

---

## 8. Knowledge Management

### 8.1 Memory System

**Memory Files Location**: `C:\Users\user\.claude\projects\D--360ai-WHATSAPP\memory\`

**Memory Categories**:
- `MEMORY.md` - Project overview and key patterns
- `architecture.md` - System architecture details
- `patterns.md` - Reusable code patterns
- `debugging.md` - Common issues and solutions
- `api-reference.md` - API documentation

### 8.2 Knowledge Updates

**When to Update Memory**:
- New feature implementation
- Architecture changes
- New patterns discovered
- Bug fixes with learnings
- Configuration changes

**Memory Update Process**:
1. Identify information to persist
2. Determine appropriate file/category
3. Write/update memory file
4. Verify no conflicts with existing memory
5. Include date and context

### 8.3 Skill System

**Skill Files Location**: `.claude/skills/`

**Available Skills**:
- `development.md` - Development workflow and patterns
- `testing.md` - Testing procedures and standards
- `deployment.md` - Deployment procedures
- `debugging.md` - Debugging techniques

---

## 9. Communication Templates

### 9.1 Status Report Template

```markdown
## Status Report - [DATE]

### Completed Tasks
- [Task ID] Task description - Status

### In Progress
- [Task ID] Task description - % complete

### Blocked
- [Task ID] Task description - Blocker reason

### Next Steps
1. Action item 1
2. Action item 2

### Questions/Concerns
- Item needing clarification
```

### 9.2 Handoff Template

```markdown
## Handoff: [FEATURE/BUG]

### Summary
Brief description of the work

### Completed Work
- Item 1
- Item 2

### Remaining Work
- [ ] Item 1
- [ ] Item 2

### Context/Notes
Important information for next agent

### Files Modified
- path/to/file1.ts
- path/to/file2.ts

### Tests
- Test suite status
- Coverage information
```

---

## 10. Appendix

### 10.1 Agent Tool Access Matrix

| Tool | Orchestrator | Researcher | Developer | Tester | Planner |
|------|:------------:|:----------:|:---------:|:------:|:-------:|
| Read | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit | ✅ | ❌ | ✅ | ✅ | ❌ |
| Write | ✅ | ❌ | ✅ | ✅ | ✅ |
| Bash | ✅ | ❌ | ✅ | ✅ | ❌ |
| Grep | ✅ | ✅ | ✅ | ✅ | ✅ |
| Glob | ✅ | ✅ | ✅ | ✅ | ✅ |
| WebFetch | ✅ | ✅ | ❌ | ❌ | ✅ |
| WebSearch | ✅ | ✅ | ❌ | ❌ | ✅ |
| Agent | ✅ | ❌ | ❌ | ❌ | ❌ |
| TaskCreate | ✅ | ❌ | ✅ | ✅ | ✅ |
| TaskUpdate | ✅ | ❌ | ✅ | ✅ | ❌ |
| SendMessage | ✅ | ✅ | ✅ | ✅ | ✅ |

### 10.2 Common Task Patterns

**Pattern: Add New API Endpoint**
```
1. Researcher: Analyze existing endpoint patterns
2. Developer: Create route file, model, and tests
3. Tester: Validate endpoint functionality
4. Orchestrator: Integrate into main app
```

**Pattern: Database Schema Change**
```
1. Researcher: Analyze current schema usage
2. Planner: Design migration strategy
3. Developer: Implement schema change with migration
4. Tester: Validate data integrity
5. Orchestrator: Approve and merge
```

**Pattern: Bug Investigation**
```
1. Researcher: Reproduce and document issue
2. Researcher: Trace code execution path
3. Developer: Implement fix
4. Tester: Verify fix and regression test
```

### 10.3 Reference Links

- **Claude Code Documentation**: https://docs.anthropic.com/claude-code
- **CrewAI Framework**: https://docs.crewai.com/
- **WhatsApp Baileys**: https://github.com/WhiskeySockets/Baileys
- **Mongoose Documentation**: https://mongoosejs.com/
- **Express.js Guide**: https://expressjs.com/

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-03-19 | Claude | Initial framework creation |

---

*This SOP Team Agent Architecture Framework is a living document that should be updated as the project evolves and new patterns emerge.*