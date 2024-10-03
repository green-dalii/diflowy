/// <reference types="astro/client" />

import type { EventContext } from "@cloudflare/workers-types";

declare namespace App {
    interface Env {
        D1: D1Database;
        GITHUB_ID: string;
        GITHUB_SECRET: string;
        [key: string]: any;
    }

    // 扩展 Env 类型以包含 locals 属性
    interface Env extends Record<string, any> {
        locals: {
            user: import("lucia").User | null;
            session: import("lucia").Session | null;
        };
    }
}

// interface EventContextWithLocalsAndCookies<Env extends Record<string, any>, Data = unknown, Vars = Record<string, unknown>> extends EventContext<Env, Data, Vars> {
//     locals: {
//       user: import("lucia").User | null;
//       session: import("lucia").Session | null;
//     };
//     cookies: {
//       get(name: string): string | null;
//       set(name: string, value: string, options?: Record<string, any>): void;
//     };
//   }
  
//   declare global {
//     type EventContext<Env extends Record<string, any>, Data = unknown, Vars = Record<string, unknown>> = EventContextWithLocalsAndCookies<Env, Data, Vars>;
//   }