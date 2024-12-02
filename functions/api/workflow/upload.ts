import { jwtVerify } from 'jose';
import * as jose from 'jose'
import { generateIdFromEntropySize } from "lucia";
import type { Env } from '../auth';
import { generateFileKey, encryptFile } from '../../crypto';

export async function onRequestPost(context: { request: Request; env: Env }) {
    try {
        const { request } = context;
        const cookie = request.headers.get('cookie');
        const jwt = cookie?.split('; ').find((row: string) => row.startsWith('auth_token='))?.split('=')[1];

        if (!jwt) {
            // If jwf is null
            console.log("No JWT found in cookie")
            return new Response(JSON.stringify({ res: 'Unauthorized' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        }
        const { payload } = await jwtVerify(jwt, new TextEncoder().encode(context.env.AUTH_SECRET));

        console.log("User Authorized", payload)
        // Get Data from POST
        const formData = await request.formData();
        // Extract data from formData
        const workflowName = formData.get('workflowname') as string;
        const description = formData.get('description') as string;
        const version = formData.get('version') as string;
        const dslFile = formData.get('dsl-file') as File;
        const tags = formData.get('tags') as string;
        const icon = formData.get('icon') as string;
        const author = JSON.stringify({ "authorName": formData.get('author-name') as string, "socialLink": formData.get('social-link') as string });
        const isPrivate = formData.get('isPrivate') || false;
        let is_private = isPrivate === "on" ? 1 : 0 || 0;
        const workspace_id = formData.get("workspace_id") as string;
        let workspaceID;
        console.log("Upload workspace id>>>", workspace_id);
        if(workspace_id !== ""){
            is_private = 1;
            workspaceID = workspace_id;
        } else {
            workspaceID = null;
        }
        // Read the file content as binary data
        console.log("Reading file content", dslFile, dslFile.name, typeof dslFile.arrayBuffer)
        const dslFileBuffer = await dslFile.arrayBuffer();
        let dslFileContent = new Uint8Array(dslFileBuffer);
        // If is private, encrypt the file content
        if (is_private === 1) {
            // Get user register time
            const userQuery = await context.env.D1.prepare(
                "SELECT created_at FROM users WHERE id = ?"
            ).bind(payload.id).first();
            if (userQuery) {
                console.log("Encrypting file content")
                // Generate a key for encryption
                const encryptionKey = await generateFileKey(
                    payload.id as string,
                    userQuery.created_at as string,
                    context.env.AUTH_SECRET
                );
                // Encrypt file content
                dslFileContent = await encryptFile(dslFileContent, encryptionKey);
            }
        }
        // generate workflow id
        const fileId = generateIdFromEntropySize(10);
        // generate workflow version id
        const versionId = generateIdFromEntropySize(10);
        // Insert data into Cloudflare D1
        console.log("Inserting data into Cloudflare D1")
        const insertQuery = await context.env.D1.prepare(
            "INSERT INTO yaml_files (id, user_id, filename, description, latest_version, tags, author_data, icon, is_private, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(fileId, payload.id, workflowName, description, version, tags, author, icon, is_private, workspaceID).run();
        console.log("Insert Workflow Query Result>>>", insertQuery);
        // Insert version data into Cloudflare D1
        const insertVersionQuery = await context.env.D1.prepare(
            "INSERT INTO yaml_versions (id, yaml_file_id, version, file_content) VALUES (?,?,?,?)"
        ).bind(versionId, fileId, version, dslFileContent).run();
        console.log("Insert Workflow Version Query Result>>>", insertVersionQuery);
        // Return response
        return new Response(JSON.stringify({ res: 'Upload successful' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 201,
        });
    } catch (error) {
        console.error('Error in uploading workflow>>>', error);
        if (error instanceof jose.errors.JOSEError) {
            console.error("JWT Expired", error);
            return new Response(JSON.stringify({ res: 'JWT Broken' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 401,
            });
        } else {
            return new Response(JSON.stringify({ res: 'Internal Server Error' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 500,
            });
        }
    }
}