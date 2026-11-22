import { HelpdeskSession } from "./session-do";
import { KbIngestWorkflow, IngestPayload } from "./workflows/ingest";
import { RepoSyncWorkflow } from "./workflows/sync-github";

export { HelpdeskSession, KbIngestWorkflow, RepoSyncWorkflow };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);


    // Trigger GitHub wikis/ folder sync Workflow
    if (url.pathname === "/api/sync-github" && request.method === "POST") {
      const instance = await env.REPO_SYNC_WORKFLOW.create({
        id: `gh-sync-${Date.now()}`,
        params: {
          owner: env.GITHUB_OWNER,
          repo: env.GITHUB_REPO,
          branch: "main",
          dir: "wikis",
        },
      });
      return Response.json({
        status: "syncing",
        workflowId: instance.id,
        repo: `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`,
      });
    }

    // Endpoint 1: Trigger async SOP ingestion Workflow
    if (url.pathname === "/api/ingest" && request.method === "POST") {
      const contentLength = Number(request.headers.get("content-length") || 0);
      if (contentLength > 100_000) {
        return Response.json({ error: "Payload too large" }, { status: 413 });
      }

      const payload = (await request.json()) as IngestPayload;
      const instance = await env.KB_INGEST_WORKFLOW.create({
        id: `${payload.docId}-${Date.now()}`,
        params: payload,
      });
      return Response.json({ status: "queued", workflowId: instance.id });
    }

    // Endpoint 2: Route employee chat to their dedicated Durable Object session
    if (url.pathname === "/api/chat" && request.method === "POST") {
      const { sessionId = "default-emp", question, category } = (await request.json()) as {
        sessionId?: string;
        question: string;
        category?: string;
      };
      const id = env.HELPDESK_SESSION.idFromName(sessionId);
      const stub = env.HELPDESK_SESSION.get(id);
      const result = await stub.chat(question, category);
      return Response.json(result);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;