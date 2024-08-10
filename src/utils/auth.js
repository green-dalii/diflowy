export function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
    return null;
}

export function parseJWT(token) {
    try {
        return jwtDecode(token);
    } catch (e) {
        console.error('Error parsing JWT:', e);
        return null;
    }
}

export function isAuthenticated() {
    const authToken = getCookie('auth_token');
    if (authToken) {
        const jwtPayload = parseJWT(authToken);
        if (jwtPayload) {
            const currentTime = Math.floor(Date.now() / 1000);
            return jwtPayload.exp > currentTime;
        }
    }
    return false;
}

export async function validateSession() {
    try {
      const response = await fetch('/api/user');
      const data = await response.json();

      if (!data.user) {
        localStorage.removeItem('username');
      } else if (!localStorage.getItem('username')) {
        localStorage.setItem('username', data.user.username);
      }
    } catch (error) {
      console.error('Error validating session:', error);
    }
  }