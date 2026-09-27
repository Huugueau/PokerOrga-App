import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import '@fontsource/inter/900.css';
import '@fontsource/oswald/500.css';
import '@fontsource/oswald/700.css';
import '@fontsource/oxanium/600.css';
import '@fontsource/oxanium/800.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/900.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/900.css';
import '@fontsource/lato/700.css';
import '@fontsource/lato/900.css';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ConfirmProvider, ToastProvider } from './components/ui';
import TimerPage from './features/live/TimerPage';
import { RequireAuth } from './lib/auth';
import { AccountPage } from './pages/AccountPage';
import { AuthPage } from './pages/AuthPages';
import { ChampionshipDetailPage, ChampionshipsPage } from './pages/ChampionshipPages';
import { HistoryDetailPage, HistoryPage } from './pages/HistoryPages';
import { CurrentLiveRedirect, LivesPage } from './pages/LivesPage';
import { EventDetailPage, PlanningPage } from './pages/PlanningPages';
import { PublicPlanPage, PublicRankingPage, PublicRegisterPage } from './pages/PublicPages';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 2000 } },
});

const shell = (el: React.ReactNode) => (
  <RequireAuth>
    <AppShell>{el}</AppShell>
  </RequireAuth>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ConfirmProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<AuthPage mode="login" />} />
              <Route path="/register" element={<AuthPage mode="register" />} />
              <Route path="/p/plan/:token" element={<PublicPlanPage />} />
              <Route path="/p/ranking/:token" element={<PublicRankingPage />} />
              <Route path="/p/register/:token" element={<PublicRegisterPage />} />
              <Route path="/" element={<RequireAuth><CurrentLiveRedirect /></RequireAuth>} />
              <Route path="/live/:id" element={<RequireAuth><TimerPage /></RequireAuth>} />
              <Route path="/lives" element={shell(<LivesPage />)} />
              <Route path="/planning" element={shell(<PlanningPage />)} />
              <Route path="/planning/:id" element={shell(<EventDetailPage />)} />
              <Route path="/championships" element={shell(<ChampionshipsPage />)} />
              <Route path="/championships/:id" element={shell(<ChampionshipDetailPage />)} />
              <Route path="/history" element={shell(<HistoryPage />)} />
              <Route path="/history/:id" element={shell(<HistoryDetailPage />)} />
              <Route path="/account" element={shell(<AccountPage />)} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
