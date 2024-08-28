import type { Env } from '../auth';

interface Workflow {
    id: number;
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
    console.log("page>>>",page,"pagesize",pageSize)
    try {
        // 计算偏移量
        const offset = (page - 1) * pageSize;

        // 查询分页数据
        const workflowsResult = await env.D1.prepare(
            'SELECT * FROM yaml_file LIMIT ? OFFSET ?'
        ).bind(pageSize, offset).all();
        console.log("workflowsResult>>>", workflowsResult)

        // 查询总数
        const totalResult = await env.D1.prepare(
            'SELECT COUNT(*) as count FROM yaml_file'
        ).first();
        console.log("totalResult>>>", totalResult)

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
        console.log("Error>>>>",error)
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}