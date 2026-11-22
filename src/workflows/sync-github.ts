import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";

export interface RepoSyncPayload {
  owner: string;   // e.g., "your-github-username"
  repo: string;    // e.g., "cf_ai_it_helpdesk"
  branch?: string; // default "main"
  dir?: string;    // default "wikis"
}

interface GitHubFileItem {
  name: string;
  path: string;
  sha: string;
  download_url: string;
  type: "file" | "dir";
}

export class RepoSyncWorkflow extends WorkflowEntrypoint<Env, RepoSyncPayload> {
  async run(event: WorkflowEvent<RepoSyncPayload>, step: WorkflowStep) {
    const { owner, repo, branch = "main", dir = "wikis" } = event.payload;

    // Step 1: List all Markdown files in the GitHub repository folder
    const files = await step.do("list-github-wiki-files", async () => {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${dir}?ref=${branch}`;
      const res = await fetch(apiUrl, {
        headers: { "User-Agent": "cf-ai-it-helpdesk-sync" },
      });
      if (!res.ok) throw new Error(`GitHub list failed: ${res.status}`);
      const items = (await res.json()) as GitHubFileItem[];
      return items.filter((f) => f.type === "file" && f.name.endsWith(".md"));
    });

    // Step 2: Process each wiki file independently (isolated retries per file)
    let totalChunks = 0;
    for (const file of files) {
      const count = await step.do(`ingest-${file.name}`, async () => {
        const rawRes = await fetch(file.download_url);
        const markdown = await rawRes.text();

        const docId = file.name.replace(/\.md$/, "");
        const titleMatch = markdown.match(/^#\s+(.+)$/m);
        const categoryMatch = markdown.match(/^category:\s*(\S+)/im);

        const title = titleMatch ? titleMatch[1].trim() : docId;
        const category = categoryMatch ? categoryMatch[1].trim().toLowerCase() : "general";

        const chunks = markdown
          .split(/\n(?=##+ )/)
          .map((section, idx) => ({
            id: `${docId}#chunk-${idx}`,
            text: `${title}\n${section.trim()}`.slice(0, 1500),
          }))
          .filter((c) => c.text.length > 40);

        if (chunks.length === 0) return 0;

        const embeddingRes = (await this.env.AI.run("@cf/baai/bge-base-en-v1.5", {
          text: chunks.map((c) => c.text),
        })) as { data: number[][] };

        await this.env.VECTORIZE.upsert(
          chunks.map((chunk, i) => ({
            id: chunk.id,
            values: embeddingRes.data[i],
            metadata: {
              docId,
              title,
              category,
              sha: file.sha, // Useful to check versions later!
              text: chunk.text,
            },
          }))
        );

        return chunks.length;
      });

      totalChunks += count;
    }

    return { syncedFiles: files.length, totalChunks };
  }
}