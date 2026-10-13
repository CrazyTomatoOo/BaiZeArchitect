# Triage 标签

各个 skill 用五个规范角色说话，这张表把它们映射到本仓库 issue tracker 里实际使用的标签字符串。

| mattpocock/skills 里的标签 | 本仓库的标签 | 含义 |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | 维护者需要先评估这条 issue |
| `needs-info` | `needs-info` | 等报告人补充信息 |
| `ready-for-agent` | `ready-for-agent` | 规格已就绪，可被 AFK agent 直接取走 |
| `ready-for-human` | `ready-for-human` | 需要人来实施 |
| `wontfix` | `wontfix` | 不会处理 |

skill 里出现某个角色（例如「打上 AFK-ready 的 triage 标签」）时，用右列对应的字符串。

右列就是本仓库的真实词表（当前与左列一致）。将来若改用别的叫法，改右列即可。

注：`wayfinder:*` 系列（`wayfinder:map` / `wayfinder:research` / `wayfinder:prototype` / `wayfinder:grilling` / `wayfinder:task`）是 `/wayfinder` 自己的标签，不属于上面这五个角色，不要把它们折算成 triage 角色。
