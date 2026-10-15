import type { Entry } from "./entry.ts";
import { claimIdsOf, idOf, parentIdOf } from "./entry.ts";
import { BaizeError } from "./errors.ts";
import { chainMembers } from "./chain.ts";
import {
  chainIdsWithState,
  chainStateRelPath,
  flattenSkipped,
  missingSkipFields,
  readChainState,
} from "./chainstate.ts";
import { computeCoverage, parseClueRef, unrealizedUsecases } from "./coverage.ts";
import { confirmationOf } from "./confirm.ts";
import { fieldDefectsOf } from "./fieldcheck.ts";
import { chainRootOf } from "./gate.ts";
import type { Catalogs } from "./catalogs.ts";
import { readCatalogs } from "./catalogs.ts";
import { isPlainObject } from "./guards.ts";
import { ALLOWED_PARENTS, CLAIM_FIELD } from "./layers.ts";
import { readEntries } from "./store.ts";
import { staleIssues } from "./stale.ts";
import type { Issue } from "./types.ts";

/** 层的中文叫法（错误消息里人读用）：键为 layer key。 */
const LAYER_LABEL: Record<string, string> = {
  ir: "初始需求",
  sr: "系统需求",
  ar: "分配需求",
  scenarios: "场景",
  usecases: "用例",
  "function-items": "功能项",
  "function-points": "功能点",
};

function fieldIssues(entry: Entry): Issue[] {
  const issues: Issue[] = [];
  for (const defect of fieldDefectsOf(entry)) {
    if (defect.problem === "absent") {
      issues.push({
        level: "ERROR",
        rule: "field.absent",
        path: entry.path,
        message: `缺少必填字段：${defect.name}`,
        fix: `在 ${entry.path} 的 frontmatter 中补上 ${defect.name}`,
      });
      continue;
    }
    const field = entry.layer.fields.find((spec) => spec.name === defect.name);
    issues.push({
      level: "ERROR",
      rule: "field.empty",
      path: entry.path,
      message: field?.emptyMessage ?? `字段为空：${defect.name}`,
      fix: `补上 ${defect.name} 的内容（空数组/空对象只用于「看过了确实没有」）`,
    });
  }
  return issues;
}

/** IR 验收线索的提醒阈值（#181）：第 8 条起报 WARNING。硬挡会逼人把线索合并成空话，
 * 而空话不可证伪，等于毁掉覆盖率基准（CONTEXT.md「验收线索」词条）。 */
const ACCEPTANCE_CLUE_LIMIT = 7;

// field.acceptance-too-many（#181）：IR 的验收线索超过阈值报 WARNING——
// 线索一多，这条 IR 多半混进了不止一个需求（该拆了）。恰好 7 条不报。
function acceptanceThresholdIssues(entry: Entry): Issue[] {
  if (entry.layer.key !== "ir") return [];
  const acceptance = entry.frontmatter["acceptance"];
  if (!isPlainObject(acceptance)) return []; // 缺 / 空 / 形状不对由 field.* 报
  const count = Object.keys(acceptance).length;
  if (count <= ACCEPTANCE_CLUE_LIMIT) return [];
  return [
    {
      level: "WARNING",
      rule: "field.acceptance-too-many",
      path: entry.path,
      message: `验收线索 ${count} 条（阈值 ${ACCEPTANCE_CLUE_LIMIT}）：这条 IR 该拆了`,
      fix: `把 ${entry.path} 拆成多条 IR，让每条的验收线索不超过 ${ACCEPTANCE_CLUE_LIMIT} 条`,
    },
  ];
}

function idIssue(entry: Entry): Issue[] {
  if (!Object.hasOwn(entry.frontmatter, "id")) return []; // 缺交由 field.absent 报
  const raw = entry.frontmatter["id"];
  if (typeof raw === "string" && raw.trim() === "") return []; // 空交由 field.empty 报

  const expected = `${entry.layer.prefix}-<三位数字>`;
  const pattern = new RegExp(`^${entry.layer.prefix}-\\d{3}$`);
  if (typeof raw === "string" && pattern.test(raw)) return [];

  // 类型不符（如 `id: 42`）也在此报——否则它会绕过 field.empty（非字符串不判空）静默通过。
  const shown = typeof raw === "string" ? raw : (JSON.stringify(raw) ?? String(raw));
  return [
    {
      level: "ERROR",
      rule: "id.invalid",
      path: entry.path,
      message: `id 不合法：「${shown}」应为 ${expected}（如 ${entry.layer.prefix}-001）`,
      fix: `把 id 改为 ${expected} 形式的顺序编号`,
    },
  ];
}

function refIssues(entry: Entry, byId: Record<string, Entry>, catalogs: Catalogs): Issue[] {
  const issues: Issue[] = [];
  const parentId = parentIdOf(entry);

  // ref.orphan（#190 新模型）：
  // - SR / AR / 功能点仍必须有父（分解树：IR → SR → AR、功能项 → 功能点）；
  // - 方案层（场景 / 用例 / 功能项 / 功能点）不再要求父边——「孤儿」判据改为
  //   「没有任何认领边」：refines / satisfies 为空或缺失即孤儿（IR 是链顶端，两者都不需要）。
  const claimField = CLAIM_FIELD[entry.layer.key];
  if (entry.layer.key !== "ir" && claimField !== undefined && claimIdsOf(entry).length === 0) {
    const ownLabel = LAYER_LABEL[entry.layer.key] ?? entry.layer.key;
    issues.push({
      level: "ERROR",
      rule: "ref.orphan",
      path: entry.path,
      message: `${entry.layer.prefix} 没有任何认领边：${claimField} 为空或缺失（${ownLabel}必须用 ${claimField} 认领至少一条 SR）`,
      fix: `给 ${entry.path} 的 frontmatter 补上 ${claimField}: [SR-…]（可多值）`,
    });
  }
  if (
    (entry.layer.key === "sr" || entry.layer.key === "ar" || entry.layer.key === "function-points") &&
    parentId === undefined
  ) {
    issues.push({
      level: "ERROR",
      rule: "ref.orphan",
      path: entry.path,
      message: `${entry.layer.prefix} 缺少父条目：parent 为空或缺失（各层必由上层条目分解而来）`,
      fix: `给 ${entry.path} 的 frontmatter 补上 parent（上层条目 id）`,
    });
  }

  // ref.parent-missing：parent 指向的条目必须存在。
  if (parentId !== undefined && !Object.hasOwn(byId, parentId)) {
    issues.push({
      level: "ERROR",
      rule: "ref.parent-missing",
      path: entry.path,
      message: `parent 指向不存在的条目：${parentId}`,
      fix: `把 ${entry.path} 的 parent 改成存在的条目 id（或先建出 ${parentId}）`,
    });
  }

  // ref.parent-not-allowed：父条目存在，但不是本层分解树允许的上层
  // （#190 新模型：IR → SR → AR、功能项 → 功能点，外加场景 → 场景例外）。
  if (parentId !== undefined) {
    const parent = byId[parentId];
    const allowed = ALLOWED_PARENTS[entry.layer.key];
    if (parent !== undefined && !allowed.includes(parent.layer.key)) {
      const ownLabel = LAYER_LABEL[entry.layer.key] ?? entry.layer.key;
      const parentLabel = LAYER_LABEL[parent.layer.key] ?? parent.layer.key;
      const allowedText = allowed.map((key) => LAYER_LABEL[key] ?? key).join("、");
      const claimField = CLAIM_FIELD[entry.layer.key];
      const tail =
        allowed.length === 0
          ? claimField !== undefined
            ? `；${ownLabel}不再挂在分解树上（它用 ${claimField} 认领 SR，无父边）`
            : "；IR 是链顶端，不允许有上层"
          : `；${ownLabel}只允许挂在${allowedText}层下`;
      issues.push({
        level: "ERROR",
        rule: "ref.parent-not-allowed",
        path: entry.path,
        message: `parent 指向的 ${parentId} 是${parentLabel}层条目，不是${ownLabel}层允许的上层${tail}`,
        fix: `把 ${entry.path} 的 parent 改成本层允许的上层条目 id`,
      });
    }
  }

  // ref.unknown-clue：covers 指向的验收线索必须存在（父条目存在，且其 acceptance 里有该线索）。
  const covers = entry.frontmatter["covers"];
  if (Array.isArray(covers)) {
    for (const item of covers) {
      const ref = parseClueRef(item);
      const parent = ref === null ? undefined : byId[ref.entryId];
      const known =
        ref !== null &&
        parent !== undefined &&
        isPlainObject(parent.frontmatter["acceptance"]) &&
        Object.hasOwn(parent.frontmatter["acceptance"] as object, ref.clueId);
      if (known) continue;
      const shown = typeof item === "string" ? item : (JSON.stringify(item) ?? String(item));
      const why =
        ref === null
          ? "不是 <条目id>#<线索id> 形式"
          : parent === undefined
            ? `条目 ${ref.entryId} 不存在`
            : `条目 ${ref.entryId} 的 acceptance 里没有线索 ${ref.clueId}`;
      issues.push({
        level: "ERROR",
        rule: "ref.unknown-clue",
        path: entry.path,
        message: `covers 引用了不存在的验收线索：${shown}（${why}）`,
        fix: "核对线索 id（父条目的 acceptance 键），或先在父条目补上该线索",
      });
    }
  }

  // ref.unknown-target：出边（关联边 + 认领边，#190）指向的条目必须存在，
  // 且必须是它该指的那一层（appearsIn 指场景、realizes 指用例、refines / satisfies 指 SR）。
  const edgeFields: Array<{ name: string; target: string; targetLayer: string }> = [];
  if (entry.layer.key === "usecases") {
    edgeFields.push({ name: "appearsIn", target: "场景", targetLayer: "scenarios" });
  }
  if (entry.layer.key === "function-items") {
    edgeFields.push({ name: "realizes", target: "用例", targetLayer: "usecases" });
  }
  const claimEdgeField = CLAIM_FIELD[entry.layer.key];
  if (claimEdgeField !== undefined) {
    edgeFields.push({ name: claimEdgeField, target: "系统需求（SR）", targetLayer: "sr" });
  }
  for (const edge of edgeFields) {
    const items = entry.frontmatter[edge.name];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const shown = typeof item === "string" ? item : (JSON.stringify(item) ?? String(item));
      const target = typeof item === "string" ? byId[item] : undefined;
      if (target === undefined) {
        issues.push({
          level: "ERROR",
          rule: "ref.unknown-target",
          path: entry.path,
          message: `${edge.name} 指向不存在的${edge.target}条目：${shown}`,
          fix: `核对 ${edge.name} 里的条目 id（或先建出 ${shown}）`,
        });
        continue;
      }
      if (target.layer.key !== edge.targetLayer) {
        const targetLabel = LAYER_LABEL[target.layer.key] ?? target.layer.key;
        issues.push({
          level: "ERROR",
          rule: "ref.unknown-target",
          path: entry.path,
          message: `${edge.name} 指向的不是${edge.target}：${item}（是${targetLabel}层条目；${edge.name} 只能指向${edge.target}）`,
          fix: `把 ${entry.path} 的 ${edge.name} 改成${edge.target}条目 id`,
        });
      }
    }
  }

  // ref.cross-edge-break（#190 断链，ERROR）：功能项 satisfies 的 SR 集合 ∩ 它 realizes 的
  // 用例所 refines 的 SR 集合 = 空。功能侧认领的需求与它承载的交互认领的需求完全不相交，
  // 说明「实现」与「交互」中间断了一环。两侧都为空时不报——那由 ref.orphan /
  // coverage.unrealized-usecase 各管各的；realizes 指向不存在 / 非用例的条目由
  // ref.unknown-target 报，这里跳过。
  if (entry.layer.key === "function-items") {
    const satisfied = claimIdsOf(entry);
    const realizedRaw = entry.frontmatter["realizes"];
    const realized = Array.isArray(realizedRaw)
      ? realizedRaw.filter((item): item is string => typeof item === "string")
      : [];
    if (satisfied.length > 0 && realized.length > 0) {
      const refined = new Set<string>();
      for (const usecaseId of realized) {
        const usecase = byId[usecaseId];
        if (usecase === undefined || usecase.layer.key !== "usecases") continue;
        for (const id of claimIdsOf(usecase)) refined.add(id);
      }
      if (refined.size > 0 && !satisfied.some((id) => refined.has(id))) {
        const fnId = idOf(entry) ?? entry.path;
        issues.push({
          level: "ERROR",
          rule: "ref.cross-edge-break",
          path: entry.path,
          message: `功能项 ${fnId} 认领的 SR（${satisfied.join("、")}）与它实现的用例所认领的 SR（${[...refined].join("、")}）完全不相交（断链）`,
          fix: `让 ${fnId} 的 satisfies 与用例的 refines 至少有一条共同的 SR，或核对 realizes 与两侧认领边是否写错`,
        });
      }
    }
  }

  // ref.unknown-element：AR 的 allocates 必须是**恰好一个**受控清单
  // baize/architecture.yaml 里的组件 slug。三种子问题都走本条：
  // ① 形状不是非空标量（数组/映射/数字/空串）——共担表达为两条 AR 各挂同一 SR；
  // ② slug 不在清单里；③ 清单缺失 = 空清单，引用任何 slug 都报。
  // null（写了空值）交 field.empty、整段缺失交 field.absent，这里不重复。
  if (entry.layer.key === "ar") {
    const allocates = entry.frontmatter["allocates"];
    if (allocates !== null && allocates !== undefined) {
      const shapeName = Array.isArray(allocates)
        ? "数组"
        : isPlainObject(allocates)
          ? "映射"
          : typeof allocates === "string" && allocates.trim() === ""
            ? "空串"
            : (JSON.stringify(allocates) ?? typeof allocates);
      if (typeof allocates !== "string" || allocates.trim() === "") {
        issues.push({
          level: "ERROR",
          rule: "ref.unknown-element",
          path: entry.path,
          message: `allocates 必须是恰好一个组件 slug（标量）：当前是${shapeName}（受控清单 baize/architecture.yaml）`,
          fix: "把 allocates 改成恰好一个清单里的组件 slug；共担表达为两条 AR 各挂同一 SR",
        });
      } else if (!catalogs.components.has(allocates)) {
        issues.push({
          level: "ERROR",
          rule: "ref.unknown-element",
          path: entry.path,
          message: `allocates 指向清单里不存在的组件：${allocates}（受控清单 baize/architecture.yaml）`,
          fix: "核对组件 slug，或先在受控清单里登记该组件",
        });
      }
    }
  }

  // ref.unknown-catalog：场景的 catalog 必须是受控清单 baize/scenario-catalogs.yaml 里的目录 slug。
  if (entry.layer.key === "scenarios") {
    const catalog = entry.frontmatter["catalog"];
    if (typeof catalog === "string" && catalog.trim() !== "" && !catalogs.scenarioCatalogs.has(catalog)) {
      issues.push({
        level: "ERROR",
        rule: "ref.unknown-catalog",
        path: entry.path,
        message: `catalog 不在场景目录词表里：${catalog}（受控清单 baize/scenario-catalogs.yaml）`,
        fix: "核对目录 slug，或先在受控清单里登记该目录",
      });
    }
  }

  return issues;
}

// sr.unallocated：SR 没有 AR 挂上（没有 AR 以它为 parent）→ WARNING。
// 反向关系现算，不落盘。
function allocationIssues(entry: Entry, byId: Record<string, Entry>): Issue[] {
  if (entry.layer.key !== "sr") return [];
  const id = idOf(entry);
  if (id === undefined) return []; // 缺 id 由 id.* / field.* 报
  const hasAr = Object.values(byId).some(
    (candidate) => candidate.layer.key === "ar" && parentIdOf(candidate) === id,
  );
  if (hasAr) return [];
  return [
    {
      level: "WARNING",
      rule: "sr.unallocated",
      path: entry.path,
      message: `SR 没有任何 AR 承接：${id}（需求拆到 AR 才算落到了架构组件上）`,
      fix: `为 ${id} 建一条 parent 指向它的 AR，或在 AR 的 allocates 里挂好组件`,
    },
  ];
}

// sr.unclaimed（#181）：SR 没有任何方案层条目认领（没有场景/用例的 refines、
// 功能项/功能点的 satisfies 指向它）→ WARNING。与 sr.unallocated 同级同风格：
// 这是拆分进度不是文件写坏，硬挡会逼人造假条目。反向关系现算，不落盘。
function unclaimedIssues(entry: Entry, byId: Record<string, Entry>): Issue[] {
  if (entry.layer.key !== "sr") return [];
  const id = idOf(entry);
  if (id === undefined) return []; // 缺 id 由 id.* / field.* 报
  const claimed = Object.values(byId).some((candidate) =>
    claimIdsOf(candidate).includes(id),
  );
  if (claimed) return [];
  return [
    {
      level: "WARNING",
      rule: "sr.unclaimed",
      path: entry.path,
      message: `SR 未被任何方案层条目认领：${id}（需求拆到方案层才算落到了交互与能力上）`,
      fix: `为 ${id} 建一条 refines/satisfies 指向它的场景、用例、功能项或功能点`,
    },
  ];
}

function issuesFor(entry: Entry, byId: Record<string, Entry>, catalogs: Catalogs): Issue[] {
  return [
    ...idIssue(entry),
    ...acceptanceThresholdIssues(entry),
    ...fieldIssues(entry),
    ...refIssues(entry, byId, catalogs),
    ...allocationIssues(entry, byId),
    ...unclaimedIssues(entry, byId),
    ...upstreamGateIssues(entry, byId),
  ];
}

/**
 * stage.upstream-unconfirmed：上游 IR 未人工确认（或确认已失效）时，下游条目是建在
 * 一个还没被认领的基准上的。这是 **IR 录入门禁的机械落地**——门禁在规格里是「阻塞」，
 * 而 `status` 把它的状态报出来（`kind: auto`）只能让人看见，拦不住手写与压力下的推进。
 *
 * 提醒级（`--strict` 升级）：它说的是「不该推进」，不是「文件写坏了」——
 * 与 `sr.unallocated` 同级（#129：默认 WARNING 不算失败，#126 否掉「渐进拆分一路红灯」）。
 * IR 自己不受这条管：它就是被确认的那一个。
 */
function upstreamGateIssues(entry: Entry, byId: Record<string, Entry>): Issue[] {
  if (entry.layer.key === "ir") return [];
  const root = chainRootOf(byId, entry);
  if (root.layer.key !== "ir") return []; // 链根不是 IR（例如孤儿 SR）另有 ref.* 报
  const confirmation = confirmationOf(root);
  if (confirmation.state === "confirmed") return [];
  const rootId = idOf(root) ?? "";
  return [
    {
      level: "WARNING",
      rule: "stage.upstream-unconfirmed",
      path: entry.path,
      message: `上游 IR 未确认：${rootId}（${
        confirmation.state === "stale" ? "确认已失效——实质内容改过" : "尚未人工确认"
      }）——下游条目建在未确认的基准上`,
      fix: `先让 ${rootId} 的 statement 与 acceptance 得到人工确认，再往下拆`,
    },
  ];
}

/**
 * 阶段状态文件的规则：跳段是全模型里代价最高的决定之一，
 * skipped 的任一段缺 by / at / why 都报 stage.skip-missing-reason（ERROR）。
 * 状态文件缺失不是错误（等价于无跳过）。
 */
async function stageIssues(cwd: string, chain: string | undefined): Promise<Issue[]> {
  const ids = chain !== undefined ? [chain] : await chainIdsWithState(cwd);
  const issues: Issue[] = [];
  for (const id of ids) {
    const state = await readChainState(cwd, id);
    if (state === undefined) continue;
    for (const { stagePath, value } of flattenSkipped(state.skipped)) {
      const missing = missingSkipFields(value);
      if (missing.length === 0) continue;
      issues.push({
        level: "ERROR",
        rule: "stage.skip-missing-reason",
        path: chainStateRelPath(id),
        message: `跳过记录不完整：${stagePath} 缺 ${missing.join(" / ")}（跳段必须留下 by + at + why）`,
        fix: `补齐 ${stagePath} 的 ${missing.join(" / ")}`,
      });
    }
  }
  return issues;
}

/** coverage.missing-clue：IR 的每条验收线索都要至少一个 SR 的 covers 指向它。
 * 覆盖率数据与 status 共用 src/coverage.ts（不各算一套）。 */
function coverageIssues(scoped: Entry[]): Issue[] {
  return computeCoverage(scoped).flatMap((coverage) =>
    coverage.missing.map((clue) => ({
      level: "ERROR" as const,
      rule: "coverage.missing-clue",
      path: coverage.path,
      message: `验收线索未覆盖：${coverage.id}#${clue.clueId}「${clue.text}」没有任何 SR 的 covers 指向它`,
      fix: `新建或修改 SR，把 ${coverage.id}#${clue.clueId} 写进其 covers；若线索已废弃，从 ${coverage.path} 的 acceptance 删掉它`,
    })),
  );
}

/** 全仓（或限定一条链）跑 field / id / ref / coverage / stage 规则，返回按 path、rule 排序的问题。 */
export async function validate(
  cwd: string,
  options: { chain?: string } = {},
): Promise<Issue[]> {
  const entries = await readEntries(cwd);
  const catalogs = await readCatalogs(cwd);
  const byId: Record<string, Entry> = {};
  for (const entry of entries) {
    const id = idOf(entry);
    if (id !== undefined && !Object.hasOwn(byId, id)) byId[id] = entry;
  }

  let scoped = entries;
  if (options.chain !== undefined) {
    if (!Object.hasOwn(byId, options.chain)) {
      throw new BaizeError("chain.not-found", `链不存在：${options.chain}`);
    }
    scoped = chainMembers(entries, options.chain);
  }

  const issues = [
    ...scoped.flatMap((entry) => issuesFor(entry, byId, catalogs)),
    ...(await stageIssues(cwd, options.chain)),
    ...coverageIssues(scoped),
    ...unrealizedUsecaseIssues(scoped, entries),
    // #155 陈旧：上下游关系现算不落盘；WARNING 直接下游 / INFO 传递（见 stale.ts 注释）。
    ...staleIssues(scoped),
  ];
  issues.sort((a, b) =>
    a.path === b.path
      ? a.rule.localeCompare(b.rule)
      : a.path.localeCompare(b.path),
  );
  return issues;
}

/**
 * coverage.unrealized-usecase：每条用例至少要被一个功能项的 realizes 指向
 * （功能侧必须有人承载这条用例）。未覆盖清单与 status 的功能拆分门禁共用
 * coverage.ts 的 unrealizedUsecases（同一份数据，不各算一套）。
 */
function unrealizedUsecaseIssues(scoped: Entry[], all: Entry[]): Issue[] {
  return unrealizedUsecases(scoped, all).map((usecase) => ({
    level: "ERROR" as const,
    rule: "coverage.unrealized-usecase",
    path: usecase.path,
    message: `用例 ${usecase.id} 未被任何功能项 realizes（功能侧没有承载它的实现）`,
    fix: `在某条 function-item 的 realizes 里加上 ${usecase.id}，或确认该用例应废弃`,
  }));
}
