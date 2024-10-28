import type { Env } from '../../auth';
import { generateFileKey, decryptFile } from '../../../crypto';
import * as jose from 'jose'
import { jwtVerify } from 'jose';

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
        // 设置解密秘钥
        let decryptionKey;
        // 判断是否为Private-Hosted文件
        const workflowMetaQuery = `SELECT * FROM yaml_files WHERE id = ?`;
        const workflowMetaResult = await env.D1.prepare(workflowMetaQuery).bind(workflowId).first();
        let isPrivate;
        if (!workflowMetaResult) {
            return new Response(JSON.stringify({ error: 'Workflow not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            isPrivate = workflowMetaResult.is_private
            if (isPrivate === 1) {
                // 如果为私密文件
                console.log("Request Private file....")
                try {
                    const cookie = request.headers.get('cookie');
                    const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];
                    if (!jwt) {
                        console.log("User Not Login.")
                        return new Response(JSON.stringify({ user: null }), {
                            headers: { 'Content-Type': 'application/json' },
                            status: 401,
                        });
                    }
                    const { payload } = await jwtVerify(jwt, new TextEncoder().encode(env.AUTH_SECRET));
                    if(payload.id != workflowMetaResult.user_id){
                        console.log("Private Deny!!", payload.id, workflowMetaResult.user_id)
                        return new Response(JSON.stringify({ error: "Forbidden" }), {
                            headers: { 'Content-Type': 'application/json' },
                            status: 403,
                        });
                    }
                    // 用户验证通过，生成解密秘钥
                    if(workflowMetaResult.created_at){
                        decryptionKey = await generateFileKey(payload.id as string, workflowMetaResult.created_at as string, env.AUTH_SECRET)
                    }
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
        }
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
        let fileContentString;
        // 如果为Private-Hosted文件
        if(isPrivate === 1 && decryptionKey){
            console.log("Decrypting File...")
            const decryptedContent = await decryptFile(fileContentUint8Array, decryptionKey as CryptoKey)
            fileContentString = fileContentDecoder.decode(decryptedContent)
        } else {
            fileContentString = fileContentDecoder.decode(fileContentUint8Array);
        }

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