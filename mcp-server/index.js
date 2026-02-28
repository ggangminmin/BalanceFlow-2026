const { Server } = require("@modelcontextprotocol/sdk/server");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types");
const fs = require("fs");
const path = require("path");

// Shared data file with the web app
const DATA_FILE = path.join(__dirname, "../data.json");

const server = new Server(
    {
        name: "balanceflow-mcp",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "get_financial_summary",
                description: "2026년 가계부의 전체 요약(예산, 회비, 찬조금)을 가져옵니다.",
                inputSchema: { type: "object", properties: {} },
            },
            {
                name: "add_transaction_via_ai",
                description: "AI를 통해 지출 내역을 추가합니다.",
                inputSchema: {
                    type: "object",
                    properties: {
                        reason: { type: "string" },
                        amount: { type: "number" },
                        source: { type: "string", enum: ["budget", "fee", "donation"] },
                    },
                    required: ["reason", "amount", "source"],
                },
            },
            {
                name: "get_monthly_report",
                description: "특정 월의 상세 지출 및 예산 현황을 가져옵니다.",
                inputSchema: {
                    type: "object",
                    properties: {
                        month: { type: "number", description: "조회할 월 (1-12)" }
                    },
                    required: ["month"]
                },
            }
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8") || '{"transactions":[], "members":[]}');

    switch (request.params.name) {
        case "get_financial_summary":
            return {
                content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
            };

        case "add_transaction_via_ai": {
            const { reason, amount, source } = request.params.arguments;
            const newTx = {
                id: Date.now(),
                reason,
                amount,
                source,
                date: new Date().toISOString().split('T')[0],
                receipts: []
            };
            data.transactions.push(newTx);
            fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
            return {
                content: [{ type: "text", text: `지출 내역 '${reason}' (${amount}원)이 추가되었습니다.` }],
            };
        }

        case "get_monthly_report": {
            const { month } = request.params.arguments;
            const txs = data.transactions.filter(t => {
                const d = new Date(t.date);
                return d.getMonth() + 1 === month && d.getFullYear() === 2026;
            });
            const total = txs.reduce((sum, t) => sum + t.amount, 0);
            return {
                content: [{ type: "text", text: `2026년 ${month}월 상세 내역: ${txs.length}건, 총액: ${total}원\n${JSON.stringify(txs, null, 2)}` }],
            };
        }

        default:
            throw new Error("Tool not found");
    }
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("BalanceFlow MCP Server running");
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});
