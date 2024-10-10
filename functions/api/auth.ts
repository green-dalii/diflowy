import { Lucia } from "lucia";
import { D1Adapter } from "@lucia-auth/adapter-sqlite";
import { D1Database } from "@cloudflare/workers-types";
import { GitHub, Google } from "arctic";

// 定义环境变量数据结构
export interface Env {
    D1: D1Database;
    GITHUB_ID: string;
    GITHUB_SECRET: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    AUTH_SECRET: string;
}

export function initializeLucia(env: Env) {
    const adapter = new D1Adapter(env.D1, {
        user: "users",
        session: "session"
    });

    const lucia = new Lucia(adapter, {
        sessionCookie: {
            attributes: {
                secure: true
            }
        },
        getUserAttributes: (attributes) => {
            return {
                // attributes has the type of DatabaseUserAttributes
                githubId: attributes.github_id,
                googleId: attributes.google_id,
                username: attributes.username
            };
        }
    });

    return lucia;
}

// 定义Github认证初始化函数
export function initializeGitHub(env: Env) {
    return new GitHub(
        env.GITHUB_ID,
        env.GITHUB_SECRET
    );
}

export function initializeGoogle(env: Env) {
    return new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, "https://diflowy.greenerai.top");
}

// 定义用户属性接口
interface DatabaseUserAttributes {
    github_id?: number;
    google_id?: number;
    username: string;
}

// 声明Lucia模块
declare module "lucia" {
    interface Register {
        Lucia: ReturnType<typeof initializeLucia>;
        DatabaseUserAttributes: DatabaseUserAttributes;
    }
}
