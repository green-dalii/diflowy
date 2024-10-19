// /functions/api/auth/login.ts

import type { EventContext } from "@cloudflare/workers-types";
import bcrypt from "bcryptjs";
import { createJWT } from "../../jwtUtils";
import type { Env } from "../auth";

interface LoginRequestBody {
  email: string;
  password: string;
}

export const onRequestPost: (context: EventContext<Env, any, Record<string, unknown>>) => Promise<Response> = async (context): Promise<Response> => {
  try {
    const { request } = context;
    // 解析请求体
    const formData = await request.formData();
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    console.log("Login email>>>", email)

    // 基本验证
    if (!email || !password) {
      return new Response(JSON.stringify({ message: "Email and password are required", success: false }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 查询用户
    const { results } = await context.env.D1.prepare(
      "SELECT * FROM users WHERE email = ?"
    ).bind(email).all();

    if (results.length === 0) {
      return new Response(JSON.stringify({ message: "No user found with this email", success: false }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    const user = results[0];

    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password_hash as string);

    if (!isPasswordValid) {
      return new Response(JSON.stringify({ message: "Invalid email or password", success: false }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 创建JWT
    const userPayload = {
      id: user.id,
      username: user.username,
      email: user.email,
      provider: 'email'
    };

    const token = await createJWT(userPayload, context.env.AUTH_SECRET);

    // 设置cookie并返回响应
    const response = new Response(JSON.stringify({ 
      success: true, 
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email 
      } 
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `auth_token=${token}; HttpOnly; Secure; Path=/; Max-Age=3600`
      }
    });

    return response;

  } catch (e) {
    console.error("Error in login:", e);
    return new Response(JSON.stringify({ message: "Internal Server Error", success: false }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};