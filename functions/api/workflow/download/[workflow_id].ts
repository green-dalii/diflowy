import type { Env } from '../../auth';

export const onRequestGet: PagesFunction<Env> = async (context) => {
    try {
        const { env, params, request } = context;
        const workflowId = params.workflow_id;
        const url = new URL(request.url);
        // Decode the entire query string
        const decodedSearch = decodeURIComponent(url.search);
        const searchParams = new URLSearchParams(decodedSearch);
        const version = searchParams.get('version');
        const workflowName = searchParams.get('name');
        console.log("Download ID>>>", workflowId, "Download Version>>>", version, "Download Name>>>", workflowName)
        const workflowResult = await env.D1.prepare(
            'SELECT file_content FROM yaml_versions WHERE yaml_file_id = ? AND version = ?'
        ).bind(workflowId, version).first();

        if (!workflowResult || !version || !workflowName) {
            console.log("Workflow not found", workflowResult, "Version not found", version, "Workflow Name not found", workflowName);
            return new Response("Workflow not found", { status: 404 });
        }

        const fileContentArrayBuffer = workflowResult.file_content as ArrayBuffer;
        const fileContentUint8Array = new Uint8Array(fileContentArrayBuffer);
        const fileContentDecoder = new TextDecoder("utf-8");
        const fileContentString = fileContentDecoder.decode(fileContentUint8Array);
        return new Response(fileContentString, {
            headers: {
                'Content-Type': 'text/yaml',
                'Content-Disposition': `attachment; filename="${workflowName}_${version}.yml"`,
            }
        });
    } catch (error) {
        console.error('Error retrieving workflow>>>', error);
        return new Response('Internal Server Error', { status: 500 });
    }
};