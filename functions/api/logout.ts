export const onRequest = async () => {
    // 设置一个过期的 Cookie 来清除 JWT
    const expiredCookie = `auth_token=; HttpOnly; Secure; Path=/; Max-Age=0`;
  
    return new Response(null, {
      status: 200, // 重定向到主页或登录页面
      headers: {
        "Set-Cookie": expiredCookie,
      },
    });
  };