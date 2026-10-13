import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BOOTSTRAP_MARKER, loadBootstrapText } from "../scripts/baize-bootstrap.mjs";

function textOfUserContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("\n");
}

/**
 * pi 侧的 using-baize 注入器（#135 分界表）：
 * - 正文与 Claude Code 的 SessionStart hook 共享同一份（scripts/baize-bootstrap.mjs）；
 * - 信封是 pi 平台特有的：context 事件里合成一条带去重标记的 user 消息。
 *
 * context 事件在每次模型调用前触发、变换是请求级的，所以每个请求都重新注入一份；
 * 先滤掉已带标记的消息再追加，保证喂给模型的上下文里始终恰好一份。
 */
export default function (pi: ExtensionAPI) {
  pi.on("context", async (event) => {
    const text = loadBootstrapText();
    const messages = event.messages.filter(
      (message) =>
        message.role !== "user" ||
        !textOfUserContent(message.content).includes(BOOTSTRAP_MARKER),
    );
    messages.unshift({ role: "user", content: text, timestamp: Date.now() });
    if (process.env.BAIZE_BOOTSTRAP_LOG) {
      appendFileSync(process.env.BAIZE_BOOTSTRAP_LOG, `${text}\n`);
    }
    return { messages };
  });
}
