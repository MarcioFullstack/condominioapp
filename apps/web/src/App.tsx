import { lazy, Suspense } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Chat from './pages/Chat';
import Cobrancas from './pages/Cobrancas';
import Conta from './pages/Conta';
import Dashboard from './pages/Dashboard';
import Lancamentos from './pages/Lancamentos';
import Login from './pages/Login';
import Solicitacoes from './pages/Solicitacoes';
import Usuarios from './pages/Usuarios';

// hls.js é pesado e só o síndico usa: carrega sob demanda.
const Cameras = lazy(() => import('./pages/Cameras'));

function Layout() {
  const { usuario, pode, carregando } = useAuth();
  if (carregando) return <p className="p-6 text-slate-500">Carregando…</p>;
  if (!usuario) return <Navigate to="/login" replace />;

  const itens = [
    pode('dashboard:ver') && { to: '/', rotulo: 'Painel', icone: '📊' },
    pode('financeiro:ver') && { to: '/lancamentos', rotulo: 'Caixa', icone: '💰' },
    { to: '/cobrancas', rotulo: pode('inadimplencia:ver', 'cobranca:gerar') ? 'Cobranças' : 'Minhas taxas', icone: '🧾' },
    { to: '/solicitacoes', rotulo: 'Pedidos', icone: '🛠️' },
    { to: '/chat', rotulo: 'Chat', icone: '💬' },
    pode('cameras:ver') && { to: '/cameras', rotulo: 'Câmeras', icone: '📹' },
    pode('usuarios:gerir') && { to: '/usuarios', rotulo: 'Cadastros', icone: '👥' },
    { to: '/conta', rotulo: 'Conta', icone: '⚙️' },
  ].filter(Boolean) as { to: string; rotulo: string; icone: string }[];

  return (
    <div className="mx-auto min-h-screen max-w-4xl pb-20">
      <header className="sticky top-0 z-30 flex items-center justify-between bg-brand px-4 py-3 text-white">
        <span className="font-semibold">Condomínio</span>
        <span className="text-sm opacity-90">{usuario.nome}</span>
      </header>
      <main className="p-4">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-4xl overflow-x-auto">
          {itens.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/'}
              className={({ isActive }) =>
                `flex min-w-[4.5rem] flex-1 flex-col items-center px-2 py-2 text-[11px] ${isActive ? 'font-semibold text-brand' : 'text-slate-500'}`
              }
            >
              <span className="text-lg leading-none">{i.icone}</span>
              {i.rotulo}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Inicio() {
  const { pode } = useAuth();
  return pode('dashboard:ver') ? <Dashboard /> : <Navigate to="/cobrancas" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        <Route path="lancamentos" element={<Lancamentos />} />
        <Route path="cobrancas" element={<Cobrancas />} />
        <Route path="solicitacoes" element={<Solicitacoes />} />
        <Route path="chat" element={<Chat />} />
        <Route path="cameras" element={<Suspense fallback={<p className="text-slate-500">Carregando…</p>}><Cameras /></Suspense>} />
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="conta" element={<Conta />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
