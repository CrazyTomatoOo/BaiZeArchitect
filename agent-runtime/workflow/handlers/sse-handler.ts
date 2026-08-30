import type { IncomingMessage, ServerResponse } from "node:http";
import { parseEventCursor, sendJson, streamEvents, type HandlerContext } from "./shared.js";

export async function match(
	method: string,
	segments: readonly string[],
	url: URL,
	request: IncomingMessage,
	response: ServerResponse,
	ctx: HandlerContext,
): Promise<boolean> {
	if (
		method === "GET"
		&& segments.length === 5
		&& segments[0] === "api"
		&& segments[1] === "workflows"
		&& segments[3] === "events"
		&& segments[4] === "stream"
	) {
		const workflowId = Number(segments[2]);
		if (!Number.isInteger(workflowId) || !ctx.projectionReader.getWorkflowProjection(workflowId)) {
			sendJson(response, 404, { error: "unknown_workflow" });
			return true;
		}
		const lastEventId = request.headers["last-event-id"];
		const cursor = parseEventCursor(url, response, typeof lastEventId === "string" ? lastEventId : undefined);
		if (cursor === null) return true;
		const watermark = ctx.eventStreamReader.getWorkflowEventWatermark(workflowId);
		if (cursor.after > watermark) {
			sendJson(response, 416, { error: "cursor_out_of_range", watermark });
			return true;
		}
		streamEvents(response, {
			eventField: "workflow-event",
			after: cursor.after,
			watermark,
			replay: (after, limit) => ctx.eventStreamReader.getWorkflowEvents(workflowId, after, limit),
			subscribe: (listener) => ctx.eventStreamReader.subscribeWorkflowEvents((event) => {
				if (event.workflowId === workflowId) listener(event);
			}),
			heartbeatMs: ctx.sseHeartbeatMs ?? 15_000,
		});
		return true;
	}

	if (
		method === "GET"
		&& segments.length === 5
		&& segments[0] === "api"
		&& segments[1] === "runs"
		&& segments[3] === "events"
		&& segments[4] === "stream"
	) {
		const runId = Number(segments[2]);
		if (!Number.isInteger(runId) || !ctx.eventStreamReader.runExists(runId)) {
			sendJson(response, 404, { error: "unknown_run" });
			return true;
		}
		const lastEventId = request.headers["last-event-id"];
		const cursor = parseEventCursor(url, response, typeof lastEventId === "string" ? lastEventId : undefined);
		if (cursor === null) return true;
		const watermark = ctx.eventStreamReader.getRunEventWatermark(runId);
		if (cursor.after > watermark) {
			sendJson(response, 416, { error: "cursor_out_of_range", watermark });
			return true;
		}
		streamEvents(response, {
			eventField: "run-event",
			after: cursor.after,
			watermark,
			replay: (after, limit) => ctx.eventStreamReader.getRunEvents(runId, after, limit),
			subscribe: (listener) => ctx.eventStreamReader.subscribeRunEvents((event) => {
				if (event.runId === runId) listener(event);
			}),
			heartbeatMs: ctx.sseHeartbeatMs ?? 15_000,
		});
		return true;
	}

	return false;
}
