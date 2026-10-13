#!/usr/bin/env node
// 「共享正文、不共享信封」的共享正文出处（#135 分界表）：
// pi 扩展（extensions/baize-context.ts）与 Claude Code 的 SessionStart hook
// 都从这里取剥掉 frontmatter 后的 using-baize 正文——剥法只此一份，
// 不各写一遍，保证两条注入路径喂给模型的文本逐字相同。
//
// 用法：
//   node baize-bootstrap.mjs           # 正文原样打到 stdout（调试）
//   node baize-bootstrap.mjs --claude  # 输出 Claude Code SessionStart hook 的 JSON 信封
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 去重标记：两条路径注入的正文都带它，注入器据此保证上下文里始终只有一份。 */
export const BOOTSTRAP_MARKER = "[baize-bootstrap]";

/** using-baize skill 正文文件（共享正文的单一来源）。 */
export const USING_BAIZE_SKILL = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "skills",
  "using-baize",
  "SKILL.md",
);

/** 读 using-baize 的 SKILL.md 并剥掉 frontmatter；唯一的剥法实现。 */
export function loadUsingBaizeBody() {
  const raw = readFileSync(USING_BAIZE_SKILL, "utf8");
  const frontmatter = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!frontmatter) {
    throw new Error(`using-baize skill 缺少 frontmatter：${USING_BAIZE_SKILL}`);
  }
  return raw.slice(frontmatter[0].length);
}

/** 注入给模型的完整文本（去重标记 + 正文），两条路径用同一份。 */
export function loadBootstrapText() {
  return `${BOOTSTRAP_MARKER}\n\n${loadUsingBaizeBody()}`;
}

function main() {
  if (process.argv.slice(2).includes("--claude")) {
    // Claude Code 的信封：SessionStart hook 的 hookSpecificOutput.additionalContext。
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: loadBootstrapText(),
        },
      })}\n`,
    );
  } else {
    process.stdout.write(loadBootstrapText());
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
