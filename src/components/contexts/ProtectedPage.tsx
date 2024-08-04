// src/components/ProtectedPage.tsx
import React, { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

interface ProtectedPageProps {
  children: ReactNode;
}

const ProtectedPage: React.FC<ProtectedPageProps> = ({ children }) => {
  const { user, loading } = useAuth();
  console.log('ProtectedPage rendered with user:', user);
  // useEffect(() => {
  //   if (!loading && !user) {
  //     console.log('用户未登录，重定向到登录页面');
  //     // window.location.href = '/login';
  //     // return (<button className="btn-primary w-full md:w-auto">Login!</button>);
  //   }
  // }, [user, loading]);

  if (loading) {
    console.log('正在加载用户数据...');
    return (<div>Loading...</div>);
  }

  if (!user) {
    console.log('用户未登录，重定向到登录页面XX');
    // return null; // 页面会被重定向，所以这里不需要渲染任何内容
    // window.location.href = '/login';
    return (<button className="btn-primary w-full md:w-auto">Login!!</button>);
  }

  return <>{children}</>;
};

export default ProtectedPage;