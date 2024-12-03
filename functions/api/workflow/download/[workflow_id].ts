import type { Env } from '../../auth';
import { generateFileKey, decryptFile } from '../../../crypto';
import * as jose from 'jose'
import { jwtVerify } from 'jose';

export const onRequestGet: PagesFunction<Env> = async (context) => {
    try {
        const { env, params, request } = context;
        const workflowId = params.workflow_id;
        if(!workflowId){
            console.log("Workflow ID not found")
            return new Response(JSON.stringify({ error: 'Bad Request' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }
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
                        console.log("User ID is not match the workflow user_id, trying to check workspace membership...UserID>>>", payload.id, "workflow UserID>>>", workflowMetaResult.user_id)
                        // 如果用户ID不匹配，判断是否为Workspace文件
                        const workspace_id = workflowMetaResult.workspace_id;
                        if(workspace_id !== undefined){
                            console.log("This workflow is workspace file, check whether user is the member.>>>", workspace_id, payload.id)
                            // 如果存在 workspace_id，则查询用户是否为成员
                            const workspaceMemberResult = await env.D1.prepare(`SELECT * FROM workspace_members WHERE user_id =? AND workspace_id =?`).bind(payload.id, workspace_id).first();
                            console.log("workspaceMemberResult>>>", workspaceMemberResult)
                            if(!workspaceMemberResult){
                                // 如果不存在成员关系，返回403 Forbidden
                                console.log("Private Deny!!", payload.id, workspace_id)
                                return new Response(JSON.stringify({ error: "Forbidden" }), {
                                    headers: { 'Content-Type': 'application/json' },
                                    status: 403,
                                });
                            }
                        } else {
                            // 如果不存在 workspace_id，则返回403 Forbidden
                            console.log("Private Deny!!", payload.id, workflowMetaResult.user_id)
                            return new Response(JSON.stringify({ error: "Forbidden" }), {
                                headers: { 'Content-Type': 'application/json' },
                                status: 403,
                            });
                        }
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
            'SELECT * FROM yaml_versions WHERE yaml_file_id = ? AND version = ?'
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
        if(isPrivate === 1){
            console.log("Decrypting File...")
            // Get user register time
            const userQuery = await context.env.D1.prepare(
                "SELECT created_at FROM users WHERE id = ?"
            ).bind(workflowResult.user_id).first();
            // 用户验证通过，生成解密秘钥
            if (userQuery) {
                decryptionKey = await generateFileKey(workflowResult.user_id as string, userQuery.created_at as string, env.AUTH_SECRET)
                console.log("File Key Generated!>>>")
            }
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