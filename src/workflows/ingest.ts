import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

export interface IngestPayload {
  docId: string;       // e.g., "sop-vpn-dns"
  title: string;       // e.g., "VPN Connected But Internal Sites Fail"
  category: string;    // e.g., "network" | "identity" | "hardware"
  markdown: string;
}

export class KbIngestWorkflow extends WorkflowEntrypoint<Env, IngestPayload> {
  async run(event: WorkflowEvent<IngestPayload>, step: WorkflowStep) {
    const { docId, title, category, markdown } = event.payload;

    // Step 1: Split Markdown by H2/H3 section headers (~1,500 chars max per chunk)
    const chunks = await step.do("chunk-markdown", async () => {
      return markdown
        .split(/\n(?=##+ )/)
        .map((section, idx) => ({
          id: `${docId}#chunk-${idx}`,
          text: `${title}\n${section.trim()}`.slice(0, 1500),
        }))
        .filter((c) => c.text.length > 40);
    });

    // Step 2: Generate 768-dim embeddings & upsert directly into Vectorize
    await step.do(
      "embed-and-upsert-vectors",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        const embeddingRes = (await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: chunks.map((c) => c.text),
        })) as { data: number[][] };

        const vectors = chunks.map((chunk, i) => ({
          id: chunk.id,
          values: embeddingRes.data[i],
          metadata: {
            docId,
            title,
            category,
            text: chunk.text,
          },
        }));

        await this.env.VECTORIZE.upsert(vectors);
        return { indexedChunks: vectors.length };
      }
    );
  }
}