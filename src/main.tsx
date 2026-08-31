import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthProvider } from '@/hooks/useAuth';
import { queryClient } from '@/lib/queryClient';
import { ToastHost } from '@/components/ui';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
        <ToastHost />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
