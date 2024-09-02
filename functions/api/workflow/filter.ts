import type { Env } from '../auth';

interface Workflow {
    id: string;
    name: string;
    description: string;
    tags: string[];
    icon: string;
}

interface GetWorkflowsResponse {
    workflows: Workflow[];
    total: number;
    page: number;
    pageSize: number;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
    console.log("Get Request....")
    const { request, env } = context;
    const url = new URL(request.url);
    console.log("url>>>", url)
    // Get Paganition Parameter
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);
    const tags = url.searchParams.getAll('tags');
    console.log("page>>>", page, "pagesize>>>", pageSize, "tags>>>", tags)
    try {
        // 计算偏移量
        const offset = (page - 1) * pageSize;

        // 构建筛选条件
        let whereClause = '';
        const bindings: any[] = [pageSize, offset]; // 为查询绑定参数初始化数组

        if (tags.length > 0) {
            // 使用 LIKE 创建筛选条件
            const likeClauses = tags.map(tag => `tags LIKE ?`).join(' OR ');
            whereClause = `WHERE ${likeClauses}`;

            // 为每个标签添加匹配绑定
            tags.forEach(tag => bindings.unshift(`%${tag}%`));
        }

        // 查询分页数据
        const workflowsQuery = `SELECT * FROM yaml_files ${whereClause} LIMIT ? OFFSET ?`;
        const workflowsResult = await env.D1.prepare(workflowsQuery).bind(...bindings).all();
        console.log("workflowsResult>>>", workflowsResult);

        // 查询总数
        const countQuery = `SELECT COUNT(*) as count FROM yaml_files ${whereClause}`;
        const totalResult = await env.D1.prepare(countQuery).bind(...bindings.slice(0, -2)).first();
        console.log("totalResult>>>", totalResult);

        const workflows: Workflow[] = (workflowsResult.results as any[]).map(row => ({
            id: row.id,
            name: row.filename,
            description: row.description,
            tags: row.tags,
            icon: row.icon
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
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.log("Error>>>>", error)
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}