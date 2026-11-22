import { DurableObject } from "cloudflare:workers";

export class HelpdeskSession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Create per-session SQLite chat table on initialization
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  async chat(userQuestion: string, categoryFilter?: string) {
    // 1. Save employee message in Durable Object SQLite
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)`,
      "user",
      userQuestion,
      Date.now()
    );

    // 2. Embed the employee's question using the exact same 768-dim model
    const queryEmbedding = (await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
      text: [userQuestion],
    })) as { data: number[][] };

    // 3. Query Vectorize for top 4 matching SOP chunks
    const matches = await this.env.VECTORIZE.query(queryEmbedding.data[0], {
      topK: 4,
      returnMetadata: "all",
      ...(categoryFilter ? { filter: { category: categoryFilter } } : {}),
    });

    // Keep chunks with >= 0.50 cosine similarity
    const relevantChunks = matches.matches.filter((m) => m.score >= 0.5);
    const kbContext =
      relevantChunks.length > 0
        ? relevantChunks
            .map((m) => `[SOP: ${m.metadata?.title}]\n${m.metadata?.text}`)
            .join("\n\n---\n\n")
        : "No matching internal IT runbook found.";

    // 4. Load last 8 conversation turns from SQLite for multi-turn memory
    const history = this.ctx.storage.sql
      .exec<{ role: string; content: string }>(
        `SELECT role, content FROM messages ORDER BY id DESC LIMIT 8`
      )
      .toArray()
      .reverse();

    // 5. Generate grounded answer using Llama 3.3 70B on Workers AI
    const systemPrompt = `You are an internal IT Helpdesk Engineer helping an employee self-troubleshoot.
Use ONLY the internal IT SOP context below to give clear, numbered diagnostic steps.
- Do not repeat steps the employee already tried earlier in the conversation.
- Ask at most ONE clarifying question (e.g., macOS vs Windows, exact error code) if needed.
- If the SOP context does not cover the issue or requires admin privileges, tell the employee to escalate to IT Tier-2.

INTERNAL IT SOP CONTEXT:
${kbContext}`;

    const aiResponse = (await this.env.AI.run(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      {
        messages: [
          { role: "system", content: systemPrompt },
          ...history.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
        ],
      }
    )) as { response: string };

    // 6. Save assistant reply & return answer with cited SOP titles
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (role, content, created_at) VALUES (?, ?, ?)`,
      "assistant",
      aiResponse.response,
      Date.now()
    );

    const sources = [
      ...new Set(relevantChunks.map((m) => String(m.metadata?.title))),
    ];

    return { answer: aiResponse.response, sources };
  }
}