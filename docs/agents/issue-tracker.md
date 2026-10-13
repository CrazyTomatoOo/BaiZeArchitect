# Issue tracker：GitHub

本仓库的 issue 与规格都是 GitHub issue，全部操作走 `gh` CLI。

## 本机的第一条规矩：`gh` 必须去掉代理

这台机器设了 `http_proxy=http://127.0.0.1:7890`，而它到 `api.github.com` **时好时坏**（实测直连 3/3 成功、走代理 2/5 成功，失败时报 `EOF` / `SSL_ERROR_SYSCALL`）。直接跑 `gh` 会随机失败，别把它当成「issue 读不到」。

```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY gh issue view 147 --comments
```

`git push` / `git fetch` 不受影响，照常用。

## 约定

- **建 issue**：`gh issue create --title "…" --body "…"`（多行正文用 heredoc）。
- **读 issue**：`gh issue view <n> --comments`；要标签时一并取。
- **列 issue**：`gh issue list --state open --json number,title,body,labels --jq '…'`，配 `--label` / `--state` 过滤。
- **评论**：`gh issue comment <n> --body "…"`。
- **打/去标签**：`gh issue edit <n> --add-label "…"` / `--remove-label "…"`。
- **关闭**：`gh issue close <n> --comment "…"`。

仓库由 `git remote -v` 推断；在 clone 里跑 `gh` 会自动认。

## 本仓库的实际用法（从历史提交与工单实测得出）

- **不使用 PR**：这套仓库的收口方式是「提交信息带票号（`feat(cli): … (#149)`）+ 直接关 issue」。不要为了合规去开 PR。
- 标签用 `ready-for-agent` 表示「规格已就绪，可被 agent 直接取走实施」；`wayfinder:*` 系列归 `/wayfinder` 自己用。
- 实施票写成 issue 的 **Acceptance criteria 复选清单**；依赖用 GitHub **原生 blocking 边**（不是正文里的文字）。

## 作为 triage 入口的 PR：否

_（若本仓库哪天把外部 PR 当功能请求收，把它改成 `是`；`/triage` 会读这个标记。）_

## skill 说「发布到 issue tracker」时

建一个 GitHub issue。

## skill 说「取出对应的票」时

`gh issue view <n> --comments`（记得去代理）。

## Wayfinding 操作（`/wayfinder` 用）

**地图**是一个 issue，**票**是它的子 issue。

- **地图**：带 `wayfinder:map` 标签的单个 issue，正文放 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **子票**：用 GitHub sub-issue 挂到地图下；没有 sub-issue 时，在地图正文里加任务清单，并在子票正文顶部写 `Part of #<地图>`。标签 `wayfinder:<类型>`（`research`/`prototype`/`grilling`/`task`）。认领后 assign 给驱动的开发者。
- **阻塞**：用 GitHub **原生 issue 依赖**（UI 可见的规范表示）：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，其中 `<blocker-db-id>` 是阻塞者的**数据库数字 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，**不是** `#number` 也不是 `node_id`）。GitHub 用 `issue_dependencies_summary.blocked_by` 报「还开着的阻塞者」（这就是实时闸门）。依赖不可用时退回子票正文顶部的 `Blocked by: #<n>, #<n>`。阻塞者全关，票才解锁。
- **前沿查询**：列地图的开启子票，去掉还有开启阻塞者（或 `Blocked by` 行里还有开启 issue）或有 assignee 的；按地图顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`（本会话的第一次写操作）。
- **解决**：`gh issue comment <n> --body "<答案>"`，再 `gh issue close <n>`，最后把一条上下文指针（要点 + 链接）追加到地图的 Decisions-so-far。
