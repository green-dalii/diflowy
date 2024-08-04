// api of user info from context.locals
export async function onRequestGet({ context }) {
    const user = context.locals.user;
    const session = context.locals.session;
  
    if (user && session) {
      return new Response(JSON.stringify({ 
        user: { 
          id: user.id,
          username: user.username 
          // Add any other user properties you want to expose
        },
        authenticated: true
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      return new Response(JSON.stringify({ 
        authenticated: false 
      }), {
        status: 200, // Changed from 401 to 200
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }