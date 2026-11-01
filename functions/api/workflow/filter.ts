import type { Env } from '../auth';
import { jwtVerify } from 'jose';
import * as jose from 'jose'

// Some uploads stored the Chinese tag names while the site renders the English
// labels (and vice versa), so a tag filter link only works if both spellings
// match. Keep these groups in sync with the tag labels offered in the UI
// (DiscoverEntrance cards / upload form).
const TAG_ALIAS_GROUPS: string[][] = [
    ["Productivity", "生产力"],
    ["Assistant", "助理"],
    ["Creative", "创意"],
    ["Social Media", "社交媒体"],
    ["Education", "教育背景"],
    ["Entertainment", "娱乐"],
    ["Finance & Business", "金融与商业"],
    ["Lifestyle & Health", "生活方式与健康"],
    ["Others", "其他"],
];

const TAG_VARIANTS = new Map<string, string[]>();
for (const group of TAG_ALIAS_GROUPS) {
    for (const name of group) {
        TAG_VARIANTS.set(name.trim().toLowerCase(), group);
    }
}

/** Every stored spelling a requested tag should match. */
function expandTagFilter(tag: string): string[] {
    const trimmed = tag.trim();
    if (trimmed.length === 0) return [];
    return TAG_VARIANTS.get(trimmed.toLowerCase()) ?? [trimmed];
}

interface Workflow {
    id: string;
    name: string;
    description: string;
    tags: string[];
    icon: string;
    latestVersion: string;
    authorData: string;
    workspace_id: string | null;
    user_id: string;
}

interface GetWorkflowsResponse {
    workflows: Workflow[];
    total: number;
    page: number;
    pageSize: number;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
    console.log("Get Filter Workflows Request....")
    const { request, env } = context;
    const url = new URL(request.url);
    console.log("url>>>", url)
    // Get Paganition Parameter
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);
    // Get Tags Parameter
    const tags = url.searchParams.getAll('tags');
    // Check if the request is for a specific user's workflows or all workflows
    const isMyFlow = url.searchParams.get('myflow') === 'yes';
    // Check if the request is for private
    const isPrivate = url.searchParams.get('isPrivate');
    console.log("page>>>", page, "pagesize>>>", pageSize, "tags>>>", tags, "isMyFlow>>>", isMyFlow, "isPrivate>>>", isPrivate)
    try {
        // 计算偏移量
        const offset = (page - 1) * pageSize;
        // 构建筛选条件
        let whereClause = '';
        const bindings: any[] = []; // 为查询绑定参数初始化数组
        // 检查是否有标签参数，并且构建筛选条件
        if (tags.length > 0) {
            // 使用 LIKE 创建筛选条件（每个标签同时匹配英文/中文别名）
            const tagVariants = tags
                .map((tag) => expandTagFilter(tag))
                .filter((variants) => variants.length > 0);
            if (tagVariants.length > 0) {
                const likeClauses = tagVariants
                    .map((variants) => `(${variants.map(() => `tags LIKE ?`).join(' OR ')})`)
                    .join(' OR ');
                whereClause = `WHERE ${likeClauses}`;
                // 为每个标签别名添加匹配绑定
                tagVariants.forEach((variants) => {
                    variants.forEach((variant) => bindings.push(`%${variant}%`));
                });
            }
        }
        // 检查是否需要筛选特定用户的工作流
        if (isMyFlow) {
            const cookie = request.headers.get('cookie');
            const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
            if (!jwt) {
                return new Response(JSON.stringify({ user: null }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 401,
                });
            }
            const { payload } = await jwtVerify(jwt, new TextEncoder().encode(env.AUTH_SECRET));
            if (whereClause) {
                whereClause += ` AND (user_id = ? OR workspace_id IN (
                    SELECT workspace_id FROM workspace_members WHERE user_id = ?
                ))`;
            } else {
                whereClause = `WHERE (user_id = ? OR workspace_id IN (
                    SELECT workspace_id FROM workspace_members WHERE user_id = ?
                ))`;
            }
            bindings.push(payload.id, payload.id);
        }
        // 检查是否为私有工作流
        if (isMyFlow && isPrivate === "yes") {
            console.log("Requesting private....")
            // 如果为个人私有
            if (whereClause) {
                whereClause += ` AND is_private = ?`;
            } else {
                whereClause = `WHERE is_private = ?`;
            }
            bindings.push(1);
        } else if (!isMyFlow && isPrivate === "yes") {
            console.log("Private Deny!!")
            return new Response(JSON.stringify({ error: "Forbidden" }), {
                headers: { 'Content-Type': 'application/json' },
                status: 403,
            });
        } else if (isPrivate === "no") {
            console.log("Requesting public....")
            if (whereClause) {
                whereClause += ` AND is_private = ?`;
            } else {
                whereClause = `WHERE is_private = ?`;
            }
            bindings.push(0);
        } else {
            console.log("Requesting public and private")
        }

        // 添加分页参数
        bindings.push(pageSize, offset);  // 分页参数应该在最后
        console.log("Query whereClause is down>>>>", whereClause, "Bingdings>>>", bindings)
        // 查询分页数据
        const workflowsQuery = `SELECT * FROM yaml_files ${whereClause} LIMIT ? OFFSET ?`;
        const workflowsResult = await env.D1.prepare(workflowsQuery).bind(...bindings).all();
        // console.log("workflowsResult>>>", workflowsResult);

        // 查询总数
        const countQuery = `SELECT COUNT(*) as count FROM yaml_files ${whereClause}`;
        const totalResult = await env.D1.prepare(countQuery).bind(...bindings.slice(0, -2)).first();
        // console.log("totalResult>>>", totalResult);

        const workflows: Workflow[] = (workflowsResult.results as any[]).map(row => ({
            id: row.id,
            name: row.filename,
            description: row.description,
            tags: row.tags,
            icon: row.icon,
            isPrivate: row.is_private,
            latestVersion: row.latest_version,
            authorData: row.author_data,
            workspace_id: row.workspace_id,
            user_id: row.user_id
        }));
        // 处理 totalResult 可能为 null 的情况
        const total = totalResult && typeof totalResult.count === 'number' ? totalResult.count : 0;

        const response: GetWorkflowsResponse = {
            workflows,
            total,
            page,
            pageSize
        };

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error("Error in Get Filter Workflows Request>>>>", error)
        if (error instanceof jose.errors.JOSEError) {
            console.error("JWT Expired", error);
            return new Response(JSON.stringify({ error: "JWT Expired" }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else {
            return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }
}