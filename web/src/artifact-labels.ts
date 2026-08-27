/**
 * artifact-labels — 产物视图(Artifact View)标签单一真相源。
 * kind、schema 字段、impactProfile 状态、apiInterface kind 的英文标识→中文呈现映射。
 * 后端 contract 测试读取本文件文本断言 FIELD_TITLES 覆盖 artifact-content-v1.schema.json 全部 property key。
 */
import type { ClientArtifactKind } from "./workflow-client.js";

/** ArtifactKind 英文标识 → 操作员可读中文名称。 */
export const ARTIFACT_KIND_LABELS: Record<string, string> = {
	analysis: "需求分析",
	scenario: "场景分析",
	usecase: "用例分析",
	function: "功能分析",
	design: "设计",
	architecture: "架构",
	data: "数据",
	api: "接口",
	requirement: "需求",
};

/** impactDimension status 枚举值 → 中文呈现。 */
export const IMPACT_STATUS_LABELS: Record<string, string> = {
	yes: "是·受影响",
	no: "否",
	unknown: "未评估",
};

/** apiInterface kind 枚举值 → 中文呈现。 */
export const API_INTERFACE_KIND_LABELS: Record<string, string> = {
	http: "HTTP",
	event: "事件",
	message: "消息",
	rpc: "RPC",
	function: "函数",
};

/**
 * schema 英文 property key → 中文标题映射(8 种 kind 共用)。
 * 必须覆盖 artifact-content-v1.schema.json 的全部 property key;
 * 后端 contract 测试断言覆盖完整性,新增 schema key 时必须同步补此映射。
 */
export const FIELD_TITLES: Record<string, string> = {
	// common
	schemaVersion: "模式版本",
	artifactKind: "产物类型",
	summary: "摘要",
	sourceRefs: "来源引用",
	diagrams: "图表",
	// sourceRef variants
	type: "类型",
	revisionId: "版本号",
	decisionId: "决策ID",
	findingId: "发现ID",
	directiveId: "指令ID",
	traceLinkId: "追踪链ID",
	// diagramSpec
	nodes: "节点",
	edges: "边",
	id: "标识",
	label: "标签",
	// impactDimension
	status: "状态",
	rationale: "理由",
	// impactProfile dimensions
	process: "流程",
	actors: "干系人",
	behavior: "行为",
	architecture: "架构",
	data: "数据",
	api: "接口",
	// requirement
	title: "标题",
	description: "描述",
	goals: "目标",
	nonGoals: "非目标",
	constraints: "约束",
	// analysis (extra)
	acceptanceCriteria: "验收标准",
	impactProfile: "影响画像",
	openQuestions: "待解问题",
	// scenario hierarchy
	domains: "域",
	nodeId: "节点标识",
	variants: "变体",
	scenarios: "场景",
	// scenarioVariant
	preconditions: "前置条件",
	trigger: "触发条件",
	mainFlow: "主流程",
	alternateFlows: "备选流程",
	expectedOutcome: "预期结果",
	// usecase
	useCases: "用例",
	actor: "干系人",
	goal: "目标",
	alternativeFlows: "备选流程",
	postconditions: "后置条件",
	// function hierarchy
	items: "功能项",
	points: "功能点",
	// functionPoint
	name: "名称",
	responsibility: "职责",
	inputs: "输入",
	outputs: "输出",
	businessRules: "业务规则",
	// changeUnit
	area: "区域",
	change: "变更",
	// design (extra)
	changeUnits: "变更单元",
	alternatives: "替代方案",
	failureHandling: "失败处理",
	testStrategy: "测试策略",
	implementationOrder: "实施顺序",
	rolloutStrategy: "上线策略",
	rollbackStrategy: "回滚策略",
	// architecture
	components: "组件",
	relationships: "关系",
	nonFunctionalRequirements: "非功能需求",
	componentId: "组件标识",
	relationshipId: "关系标识",
	fromComponentId: "起点组件",
	toComponentId: "终点组件",
	interaction: "交互",
	layer: "层级",
	boundary: "边界",
	layout: "布局",
	componentPositions: "组件位置",
	relationshipWaypoints: "关系路径",
	boundaries: "边界列表",
	x: "X坐标",
	y: "Y坐标",
	// data catalog
	entities: "实体",
	relations: "关系",
	entityId: "实体标识",
	fieldId: "字段标识",
	fields: "字段",
	primaryKey: "主键",
	uniqueKeys: "唯一键",
	indexes: "索引",
	nullable: "可空",
	fromEntityId: "起点实体",
	fromFieldIds: "起点字段",
	toEntityId: "终点实体",
	toFieldIds: "终点字段",
	cardinality: "基数",
	onDelete: "删除策略",
	onUpdate: "更新策略",
	// api OpenAPI
	openapi: "OpenAPI版本",
	info: "接口信息",
	version: "版本",
	servers: "服务器",
	url: "地址",
	tags: "标签",
	paths: "路径",
	schemas: "Schema定义",
	securitySchemes: "安全方案",
	security: "安全",
	// openapi operation
	operationId: "操作标识",
	parameters: "参数",
	requestBody: "请求体",
	responses: "响应",
	content: "内容",
	required: "必填",
	in: "位置",
	"application/json": "JSON",
	get: "GET",
	post: "POST",
	put: "PUT",
	delete: "DELETE",
	patch: "PATCH",
	schema: "Schema",
};

/** schema 英文 key → 中文标题;未知 key 原样返回(数据位诚实显示)。 */
export function fieldTitle(key: string): string {
	return FIELD_TITLES[key] ?? key;
}

/** schemaRef(如 "artifact/analysis/v1") → kind 中文 + 版本号(如 "需求分析 v1");解析失败原样返回。 */
export function schemaRefLabel(schemaRef: string): string {
	const match = /^artifact\/([^/]+)\/(v\d+)$/.exec(schemaRef);
	if (!match) return schemaRef;
	return `${ARTIFACT_KIND_LABELS[match[1]] ?? match[1]} ${match[2]}`;
}

/** 当前页面产物内容查看器可切换的 8 个生产 kind。 */
export const ARTIFACT_VIEW_KINDS: readonly ClientArtifactKind[] = [
	"analysis", "scenario", "usecase", "function", "design", "architecture", "data", "api",
];
