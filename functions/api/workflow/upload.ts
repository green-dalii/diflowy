import { jwtVerify } from 'jose';
import * as jose from 'jose'
import { generateIdFromEntropySize } from "lucia";
import type { Env } from '../auth';

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
        console.log("Upload API Data>>>", formData)
        // Extract data from formData
        const workflowName = formData.get('workflowname') as string;
        const description = formData.get('description') as string;
        const version = formData.get('version') as string;
        const dslFile = formData.get('dsl-file') as File;
        const tags = formData.get('tags') as string;
        const icon = formData.get('icon') as string;
        const author = JSON.stringify({ "authorName": formData.get('author-name') as string, "socialLink": formData.get('social-link') as string });
        const isPrivate = formData.get('isPrivate') || false;
        console.log("isPrivate>>>", isPrivate)
        const is_private = isPrivate === "yes" ? 1 : 0 || 0;
        // Read the file content as binary data
        console.log("Reading file content", dslFile, dslFile.name, typeof dslFile.arrayBuffer)
        const dslFileBuffer = await dslFile.arrayBuffer();
        const dslFileContent = new Uint8Array(dslFileBuffer);
        // generate workflow id
        const fileId = generateIdFromEntropySize(10);
        // generate workflow version id
        const versionId = generateIdFromEntropySize(10);
        // Insert data into Cloudflare D1
        console.log("Inserting data into Cloudflare D1")
        const insertQuery = await context.env.D1.prepare(
            "INSERT INTO yaml_files (id, user_id, filename, description, latest_version, tags, author_data, icon, is_private) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(fileId, payload.id, workflowName, description, version, tags, author, icon, is_private).run();
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