# BalanceFlow 2026 Implementation Plan

## 🎯 Project Goal
Create a premium, AI-orchestrated account book for 2026 that provides smart financial insights and a beautiful glassmorphism interface.

## 🏗 Phase 1: Harmonization & Local Sync
- [ ] **Data Source Harmonization**: Currently, the MCP server uses `data.json` while the web app uses Supabase. We need to decide on a primary source or implement a sync mechanism.
- [ ] **MCP Connection**: Verify that the MCP server can be registered by GPT/Claude Desktop for local data access.
- [ ] **API Verification**: Ensure `generateAIReport` in `main.js` correctly uses the `VITE_GPT_API_KEY`.

## 🤖 Phase 2: AI Orchestration Workflow
### 1. Planning (Gemini)
- **Goal Setting Feature**:
  - Store monthly targets in a new Supabase table `goals`.
  - Schema: `id`, `month`, `year`, `target_amount`.
  - Default goal: ₩ 1,500,000 per month.
- **Predictive Analysis**:
  - Calculate "Burn Rate" based on current spending vs. days remaining in the month.


### 2. Summarization & Tooling (GPT)
- Update MCP tools (`get_financial_summary`, etc.) to include goal information.
- Summarize development requests from the plan.

### 3. Logic Implementation (Claude)
- Integrate goal tracking into `main.js`.
- Implement calculations for "Goal vs. Actual" spending.

### 4. UI/UX Polish (Codex)
- Create a dedicated "Goal Tracking" widget in the Dashboard.
- Enhance the `AnalysisView` with a goal progression chart.

## 🛠 Next Steps (Immediate)
1. **Antigravity** approves this plan.
2. **Gemini** (Planner) will detail the Goal Setting feature.
3. **Claude** (Developer) will unify the data sources.
