import { HelpdeskSession } from "./session-do";
import { KbIngestWorkflow, IngestPayload } from "./workflows/ingest";

export { HelpdeskSession, KbIngestWorkflow };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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