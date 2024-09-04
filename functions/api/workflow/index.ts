import type { Env } from '../auth';

interface Workflow {
    id: string;
    name: string;
    description: string;
    tags: string[];
    icon: string;
    file_content?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
    console.log("Get Request....")
    const { request, env } = context;
    const url = new URL(request.url);
    console.log("url>>>", url)
    // 提取 workflow_id 参数
    const workflowId = url.searchParams.get('workflowId');
    console.log("workflowId>>>", workflowId)
    try {
        console.log("Querying Database for Workflow...")
        // 查询特定的 workflow
        const workflowQuery = `SELECT * FROM yaml_files WHERE id = ?`;
        const workflowResult = await env.D1.prepare(workflowQuery).bind(workflowId).first();
        console.log("workflowResult>>>", workflowResult);
        if (!workflowResult) {
            return new Response(JSON.stringify({ error: 'Workflow not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        console.log("Workflow Found...")
        // 将file_content从数据库读取 BLOB 数据并转换为 Uint8Array，然后使用 TextDecoder 将其转换为字符串
        // const fileContentBlob = workflowResult.file_content;
        // const fileContentArrayBuffer = workflowResult.file_content;
        const fileContentUint8Array = workflowResult.file_content as Uint8Array;
        console.log("typeof fileContentUint8Array>>>",typeof fileContentUint8Array); // 应该输出 "object"
        console.log("",fileContentUint8Array instanceof Uint8Array); // 应该输出 "true"
        const fileContentDecoder = new TextDecoder("utf-8");
        const fileContentString = fileContentDecoder.decode(fileContentUint8Array);
        console.log("fileContent converted to string>>>", fileContentString)

        // 将查询结果映射到 Workflow 类型
        const workflow: Workflow = {
            id: workflowResult.id as string,
            name: workflowResult.filename as string,
            description: workflowResult.description as string,
            tags: JSON.parse(workflowResult.tags as string),
            icon: workflowResult.icon as string,
            file_content: fileContentString
        };

        return new Response(JSON.stringify(workflow), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error("Error>>>>", error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};