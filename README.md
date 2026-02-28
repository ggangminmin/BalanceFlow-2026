# BalanceFlow 2026 | 오케스트레이션 가계부

이 프로젝트는 안티그래비티(기획/지휘)를 중심으로 제미나이, GPT, 클로로드, 코덱스의 역할을 분담하여 개발된 2026년 가계부 웹 앱입니다.

## 🤖 역할 분담 (Orchestration)
- **기획 (Gemini)**: 가계부 구조 설계 및 사용자 흐름 정의
- **글쓰기 (GPT + MCP)**: 지출 분석 리포트 및 금융 통찰 제공 (MCP 연결 준비 완료)
- **개발 (Claude)**: 코어 비즈니스 로직 및 상태 관리 구현
- **대시보드 (Codex)**: 프리미엄 글래스모피즘 UI/UX 디자인

## 🚀 주요 기능
1. **2026 예산 관리**: 320만원 초기 예산에서 지출에 따라 실시간 차감
2. **회비/찬조금 분리 관리**: 각각의 풀(Pool)을 형성하고 지출 시 출처를 선택하여 자동 합산/차감
3. **영수증 관리**: 지출 항목당 최대 5장의 영수증 업로드 및 미리보기 지원
4. **AI 통찰**: 현재 잔액과 지출 패턴에 따른 GPT 기반 맞춤형 조언

## 🔗 GPT API 및 MCP 연동 가이드
사용자가 제공한 API 키는 `./src/api-config.js` 또는 환경 변수로 설정하여 사용할 수 있습니다.

### MCP (Model Context Protocol) 설정
GPT가 이 가계부의 데이터를 읽고 쓸 수 있도록 하려면 다음과 같이 MCP 서버를 구성하세요:

1. `mcp-server/` 디렉토리의 서버를 실행합니다.
2. ChatGPT Desktop 앱이나 Claude Desktop의 MCP 설정에 추가합니다.
   ```json
   {
     "mjs-account-book": {
       "command": "node",
       "args": ["C:/Users/AIWEB/.gemini/antigravity/scratch/account-book-2026/mcp-server/index.js"]
     }
   }
   ```

## 🛠 기술 스택
- **Vite** (Build Tool)
- **Vanilla JS** (Logic)
- **CSS3 with Glassmorphism** (Design)
- **Local Storage** (Persistence)
