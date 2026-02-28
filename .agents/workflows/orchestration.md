---
description: BalanceFlow 2026 AI Orchestration Workflow
---
// turbo-all
# BalanceFlow 2026 AI Orchestration

This workflow defines the collaborative roles of AI entities in the development of the BalanceFlow 2026 account book.

## 🎭 Roles & Responsibilities

1.  **Antigravity (Director)**:
    - Oversees the entire project.
    - Manages task coordination and final verification.
    - Directs other AI roles to their specific tasks.

2.  **Gemini (Planner)**:
    - Responsible for architecture and project planning.
    - Designs data structures and core logic flows.
    - Creates the `implementation_plan.md`.

3.  **GPT (Communicator & Summarizer)**:
    - summarize Gemini's plans into concise developer requests.
    - Interfaces with the **MCP Server** to read and write project data.
    - Communicates requirements to Claude.
    - API Key: Managed via `.env` (VITE_GPT_API_KEY).

4.  **Claude (Developer)**:
    - Implements the core business logic and state management.
    - Translates GPT's summarized requests into working code.
    - Maintains `main.js` and `src/` modules.

5.  **Codex (Designer)**:
    - Builds the premium Glassmorphism UI/UX.
    - Creates advanced visualizations and dashboards.
    - Enhances the `AnalysisView` with Chart.js and interactive elements.

## 🔃 Execution Flow

1.  **Planning (Gemini)** -> Antigravity reviews and approves.
2.  **Summarization (GPT)** -> Summarizes the approved plan and checks stats via MCP.
3.  **Instruction (GPT)** -> Sends summarized instructions to Claude.
4.  **Development (Claude)** -> Implements the logic.
5.  **Visualization (Codex)** -> Adds design Polish and charts to the dashboard.
6.  **Verification (Antigravity)** -> Final tests and walkthrough creation.
