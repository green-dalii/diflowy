import type { Env } from '../auth';
import * as jose from 'jose'
import { jwtVerify } from 'jose';
import { generateFileKey, decryptFile } from '../../crypto';

interface Workflow {
    id: string;
    name: string;
    description: string;
    versions: string[];
    current_version: string;
    tags: string[];
    icon: string;
    isPrivate: number;
    authorData: object;
    update_time: string;
    file_content?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
    console.log("Get Request....")
    const { request, env } = context;
    const url = new URL(request.url);
    // 提取 workflow_id 参数
    const workflowId = url.searchParams.get('workflowId');
    // 提取 version 参数
    const workflowVersion = url.searchParams.get('version')
    console.log("workflowId>>>", workflowId, "workflowVersion>>>", workflowVersion)
    // 设置解密秘钥
    let decryptionKey;
    let isPrivate;
    try {
        console.log("Querying Database for Workflow...")
        // 查询特定的 workflow
        const workflowQuery = `SELECT * FROM yaml_files WHERE id = ?`;
        const workflowResult = await env.D1.prepare(workflowQuery).bind(workflowId).first();
        if (!workflowResult) {
            return new Response(JSON.stringify({ error: 'Workflow not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        // 判断是否为Private-Hosted文件
        isPrivate = workflowResult.is_private;
        // console.log("isPrivate>>>", typeof(isPrivate), isPrivate, isPrivate === 1)
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
                if(payload.id != workflowResult.user_id){
                    console.log("Private Deny!!", payload.id, workflowResult.user_id)
                    return new Response(JSON.stringify({ error: "Forbidden" }), {
                        headers: { 'Content-Type': 'application/json' },
                        status: 403,
                    });
                }
                // 用户验证通过，生成解密秘钥
                console.log("Generating File Key....")
                if(workflowResult.created_at){
                    decryptionKey = await generateFileKey(payload.id as string, workflowResult.created_at as string, env.AUTH_SECRET)
                    console.log("File Key Generated!>>>", decryptionKey)
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
        console.log("Workflow Found...", "isPrivate>>>", isPrivate, "isPrivate===1>>>", isPrivate === 1)
        // 查询Workflow所有版本
        const versionsQuery = `SELECT version FROM yaml_versions WHERE yaml_file_id =?`;
        const versionsResult = await env.D1.prepare(versionsQuery).bind(workflowId).all();
        // 提取所有版本号得到列表
        let versions = versionsResult.results.map(row => row.version) as string[];
        // 按版本号倒序排列
        versions.sort((a, b) => {
            const numA = parseFloat(a as string);
            const numB = parseFloat(b as string);
            return numB - numA;
        });
        // 若未指定版本默认返回最新版本的 workflow
        let queryVersion = ""
        if (!workflowVersion) {
            queryVersion = workflowResult.latest_version as string;
        } else {
            queryVersion = workflowVersion;
        };
        const versionQuery = `SELECT * FROM yaml_versions WHERE yaml_file_id =? AND version =?`;
        const versionResult = await env.D1.prepare(versionQuery).bind(workflowId, queryVersion).first();
        // 将file_content从数据库读取 BLOB 数据并转换为 Uint8Array，然后使用 TextDecoder 将其转换为字符串
        if (!versionResult) {
            return new Response(JSON.stringify({ error: 'Workflow version not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }
        console.log("Loading file buffer....")
        const fileContentArrayBuffer = versionResult.file_content as ArrayBuffer;
        const fileContentUint8Array = new Uint8Array(fileContentArrayBuffer);
        const fileContentDecoder = new TextDecoder("utf-8");
        let fileContentString;
        // 如果为Private-Hosted文件
        if(isPrivate === 1){
            console.log("Decrypting File...")
            const decryptedContent = await decryptFile(fileContentUint8Array, decryptionKey as CryptoKey)
            fileContentString = fileContentDecoder.decode(decryptedContent)
        } else {
            console.log("No need decrypt, return content directly")
            fileContentString = fileContentDecoder.decode(fileContentUint8Array);
        }
        console.log("Result prepared.")
        // 将查询结果映射到 Workflow 类型
        const workflow: Workflow = {
            id: workflowResult.id as string,
            name: workflowResult.filename as string,
            description: workflowResult.description as string,
            versions: versions,
            current_version: queryVersion,
            tags: JSON.parse(workflowResult.tags as string),
            icon: workflowResult.icon as string,
            isPrivate: workflowResult.is_private as number,
            authorData: JSON.parse(workflowResult.author_data as string),
            update_time: versionResult.created_at as string,
            file_content: fileContentString
        };

        return new Response(JSON.stringify(workflow), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error("Error in return a single workflow json>>>>", error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};