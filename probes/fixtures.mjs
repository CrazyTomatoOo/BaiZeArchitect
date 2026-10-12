/**
 * 探针的初始项目状态（fixtures）。
 *
 * 每个 fixture 在一个干净目录里搭出「链走到哪一段」的真实形状：
 * - 条目文件直接按当前 CLI 的 schema 手写（形状见 src/layers.ts）；
 * - `confirmed` 块不手写——指纹必须由真 CLI 的 `baize accept` 计算；
 * - 需要 CLI 的项目装的是本地 checkout（`file:<repo>`，符号链接安装），
 *   agent 用 `npx baize` / `node_modules/.bin/baize` 就能跑真命令。
 *
 * 每个 fixture 带 `verify`：搭完先用真 CLI 断言状态到位，防止 CLI 演进后
 * 探针静默变成「探的不是预想的状态」。
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const sh = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, ...opts }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${cmd} ${args.join(" ")} 失败：${stderr || stdout || error.message}`));
      } else {
        resolve(stdout);
      }
    });
  });

const w = (dir, rel, text) =>
  fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true }).then(() =>
    fs.writeFile(path.join(dir, rel), text, "utf8"),
  );

/** 项目装本地 checkout 的 baize 包（#135 开发期形态：指向本地包，不发布）。 */
async function withBaizePackage(dir, repo) {
  await w(
    dir,
    "package.json",
    `${JSON.stringify({ name: "probe-project", private: true, dependencies: { baize: `file:${repo}` } }, null, 2)}\n`,
  );
  await sh("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir });
}

/** 项目里的真 CLI（node_modules/.bin/baize，符号链接回本地 checkout）。 */
const baize = (dir, args) => sh("node_modules/.bin/baize", args, { cwd: dir });

const ARCHITECTURE = `components:
  export-service:
    name: 导出服务
    description: 把查询结果渲染成导出文件
  audit-log:
    name: 审计日志
    description: 记录导出行为留痕
`;

const SCENARIO_CATALOGS = `catalogs:
  compliance: 合规与审计
  self-service: 客户自助
`;

/** IR-001（未确认）：验收两条，statement 一句。 */
const IR = `---
id: IR-001
title: 支持用户数据导出
parent: null
acceptance:
  a1: 能导出 CSV
  a2: 导出需在 30 秒内完成
---
用户要求能把自己的数据带走，不能锁死在系统里。
`;

/** IR-001 确认后又被改过的版本（a2 措辞变化 → 下游复核指纹失效）。 */
const IR_EDITED = `---
id: IR-001
title: 支持用户数据导出
parent: null
acceptance:
  a1: 能导出 CSV
  a2: 导出需在 60 秒内完成
---
用户要求能把自己的数据带走，不能锁死在系统里。
`;

const SR = `---
id: SR-001
title: 统一导出服务
parent: IR-001
covers:
  - IR-001#a1
  - IR-001#a2
---
系统应提供统一的导出能力，支持 CSV 格式并在时限内完成生成。
`;

const AR = `---
id: AR-001
title: 导出服务承担 CSV 生成
parent: SR-001
allocates: export-service
---
导出服务负责把查询结果渲染成 CSV 文件。
`;

const SC = `---
id: SC-001
title: 财务月度对账导出
parent: SR-001
catalog: compliance
trigger: 每月初财务发起对账
expectedOutcome: 上月全部交易生成一份 CSV 交付内审归档
stakeholders:
  - 财务
  - 内审
---
每月初，财务要把上月的全部交易导出成 CSV，交给内审归档。
`;

const UC = `---
id: UC-001
title: 导出上月交易
parent: SR-001
appearsIn:
  - SC-001
goal: 拿到上月的完整交易 CSV
stakeholders:
  - 财务
---
财务选择上月的账期，系统生成 CSV 文件并供下载归档。
`;

/** 从 status --chain 抽链详情（校验用）。 */
async function chainOf(dir, chainId) {
  const out = JSON.parse(await baize(dir, ["status", "--chain", chainId, "--json"]));
  return out.chain;
}

/** 从 status 抽全仓链列表（校验用）。 */
async function chainsOf(dir) {
  const out = JSON.parse(await baize(dir, ["status", "--json"]));
  return out.chains;
}

/** 从 status --item 抽单条目的确认状态（校验用）。 */
async function confirmationOf(dir, id) {
  const out = JSON.parse(await baize(dir, ["status", "--item", id, "--json"]));
  return out.item.confirmation.state;
}

export const FIXTURES = {
  /** 没有 baize/、没有 baize 包：一个普通的脚本项目。 */
  "plain-project": {
    note: "无 baize/：普通脚本项目（using-baize 的不该触发场景）",
    async build(dir) {
      await w(
        dir,
        "app.py",
        [
          "import csv",
          "",
          "def total(path):",
          '    with open(path) as f:',
          "        rows = list(csv.reader(f))",
          "        return len(rows) - 1",
          "",
          'if __name__ == "__main__":',
          '    n = total("data.csv")',
          "    if n > 0:",
          '        print(f"{n} 行")',
          "",
        ].join("\n"),
      );
      await w(dir, "data.csv", "日期,金额\n");
      await w(dir, "README.md", "# 对账小工具\n\n把 data.csv 的行数统计出来。\n");
    },
    async verify(dir) {
      await fs.access(path.join(dir, "app.py"));
    },
  },

  /** 有 baize/（受控清单就位）但还没有任何条目：链还没起。 */
  "baize-init": {
    note: "baize/ 就位、零条目：新诉求到达时 IR 尚不存在",
    async build(dir, repo) {
      await withBaizePackage(dir, repo);
      await w(dir, "baize/architecture.yaml", ARCHITECTURE);
      await w(dir, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS);
    },
    async verify(dir) {
      const chains = await chainsOf(dir);
      if (chains.length !== 0) throw new Error(`期望零条链，实际 ${chains.length}`);
    },
  },

  /** IR-001 已写、未确认（IR 录入门禁未过）。 */
  "ir-unconfirmed": {
    note: "IR 已写未确认：IR 录入门禁未过",
    async build(dir, repo) {
      await FIXTURES["baize-init"].build(dir, repo);
      await w(dir, "baize/ir/IR-001.md", IR);
    },
    async verify(dir) {
      if ((await confirmationOf(dir, "IR-001")) !== "unconfirmed") {
        throw new Error("期望 IR-001 未确认");
      }
    },
  },

  /** IR-001 已确认（accept 过，指纹有效）。 */
  "ir-confirmed": {
    note: "IR 已确认：SR 拆分的前置条件就位",
    async build(dir, repo) {
      await FIXTURES["ir-unconfirmed"].build(dir, repo);
      await baize(dir, ["accept", "IR-001"]);
    },
    async verify(dir) {
      if ((await confirmationOf(dir, "IR-001")) !== "confirmed") {
        throw new Error("期望 IR-001 已确认");
      }
    },
  },

  /** IR 确认 + SR-001 写好（covers 全覆盖），尚无 AR。 */
  "sr-written": {
    note: "链到 SR：SR 已写、尚无 AR / 场景",
    async build(dir, repo) {
      await FIXTURES["ir-confirmed"].build(dir, repo);
      await w(dir, "baize/sr/SR-001.md", SR);
    },
    async verify(dir) {
      const chain = await chainOf(dir, "IR-001");
      if (!chain.items.some((item) => item.id === "SR-001")) throw new Error("期望 SR-001 在链上");
      const gate = chain.gates.find((g) => g.gate === "sr-ar");
      if (!gate || gate.state !== "pending") throw new Error("期望 SR→AR 门禁未过");
    },
  },

  /** 链到 AR：SR-001 已由 AR-001 承接。 */
  "ar-written": {
    note: "链到 AR：SR 已有组件承接",
    async build(dir, repo) {
      await FIXTURES["sr-written"].build(dir, repo);
      await w(dir, "baize/ar/AR-001.md", AR);
    },
    async verify(dir) {
      const chain = await chainOf(dir, "IR-001");
      if (!chain.items.some((item) => item.id === "AR-001")) throw new Error("期望 AR-001 在链上");
      const gate = chain.gates.find((g) => g.gate === "sr-ar");
      if (!gate || gate.state !== "passed") throw new Error("期望 SR→AR 门禁已过");
    },
  },

  /** 链到场景：SR-001 下已有 SC-001。 */
  "scenario-written": {
    note: "链到场景：SR 已有场景",
    async build(dir, repo) {
      await FIXTURES["sr-written"].build(dir, repo);
      await w(dir, "baize/scenarios/SC-001.md", SC);
    },
    async verify(dir) {
      const chain = await chainOf(dir, "IR-001");
      if (!chain.items.some((item) => item.id === "SC-001")) throw new Error("期望 SC-001 在链上");
    },
  },

  /** 链到用例：SC-001 下已有 UC-001。 */
  "usecase-written": {
    note: "链到用例：场景已有用例",
    async build(dir, repo) {
      await FIXTURES["scenario-written"].build(dir, repo);
      await w(dir, "baize/usecases/UC-001.md", UC);
    },
    async verify(dir) {
      const chain = await chainOf(dir, "IR-001");
      if (!chain.items.some((item) => item.id === "UC-001")) throw new Error("期望 UC-001 在链上");
    },
  },

  /** 上游改过、下游没复核：status 报直接陈旧 1 条。 */
  "stale-downstream": {
    note: "上游改过：status 报直接陈旧 1 条（SR-001 待复核）",
    async build(dir, repo) {
      await FIXTURES["sr-written"].build(dir, repo);
      // SR-001 的确认里记下对上游 IR-001 的复核指纹；
      // 之后改 IR-001 的验收措辞 → 指纹失效 → 直接陈旧。
      await baize(dir, ["accept", "SR-001"]);
      await w(dir, "baize/ir/IR-001.md", IR_EDITED);
    },
    async verify(dir) {
      const chain = await chainOf(dir, "IR-001");
      if (chain.stale.direct.length !== 1 || chain.stale.direct[0] !== "SR-001") {
        throw new Error(`期望直接陈旧 = [SR-001]，实际 ${JSON.stringify(chain.stale.direct)}`);
      }
    },
  },
};
