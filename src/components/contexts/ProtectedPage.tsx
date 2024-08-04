// src/components/ProtectedPage.tsx
import React, { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

interface ProtectedPageProps {
  children: ReactNode;
}

const ProtectedPage: React.FC<ProtectedPageProps> = ({ children }) => {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && !user) {
      window.location.href = '/login';
    }
  }, [user, loading]);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return null; // 页面会被重定向，所以这里不需要渲染任何内容
  }

  return <>{children}</>;
};

export default ProtectedPage;