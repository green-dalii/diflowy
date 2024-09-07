import type { Env } from '../auth';

export const onRequestGet: PagesFunction<Env> = async (context) => {
    const { request, env, params } = context;
    const workflowId = params.workflow_id; // 假设你用URL参数传入ID
    console.log("Download ID>>>", workflowId)

    try {
        // 从数据库获取工作流内容
        const workflowResult = await env.D1.prepare(
            'SELECT file_content FROM yaml_files WHERE id = ?'
        ).bind(workflowId).first();

        if (!workflowResult) {
            return new Response("Workflow not found", { status: 404 });
        }
        const fileContentArrayBuffer = workflowResult.file_content as ArrayBuffer;
        const fileContentUint8Array = new Uint8Array(fileContentArrayBuffer);
        const fileContentDecoder = new TextDecoder("utf-8");
        const fileContentString = fileContentDecoder.decode(fileContentUint8Array);
        // 将内容作为YAML文件返回
        return new Response(fileContentString, {
            headers: {
                'Content-Type': 'text/yaml',
                'Content-Disposition': `attachment; filename="${workflowResult.file_name}.yml"`,
            }
        });
    } catch (error) {
        console.error('Error retrieving workflow:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
};