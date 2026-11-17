import React, { useState } from 'react';
import {
  Activity,
  Bell,
  Building2,
  Code2,
  FileText,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { t } from './lib/i18n.ts';
import { LoginView } from './components/LoginView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { ReportsModule } from './components/ReportsModule.tsx';
import { PatientsModule } from './components/PatientsModule.tsx';
import { NotificationsModule } from './components/NotificationsModule.tsx';
import { PlatformAdminModule } from './components/PlatformAdminModule.tsx';

type NavTab =
  | 'dashboard'
  | 'reports'
  | 'patients'
  | 'notifications'
  | 'organization'
  | 'integrations'
  | 'audit'
  | 'apidocs';

const WorkspaceShell: React.FC = () => {
  const { user, hospital, language, setLanguage, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  if (!user) {
    return <LoginView />;
  }

  const isSuper = user.role === 'super_admin';
  const isHospitalAdmin = user.role === 'hospital_admin';
  const isPatient = user.role === 'patient';

  const navItems: Array<{ id: NavTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'dashboard', label: t(language, 'dashboard'), icon: LayoutDashboard },
    { id: 'reports', label: t(language, 'reports'), icon: FileText },
  ];

  if (!isPatient) {
    navItems.push({ id: 'patients', label: t(language, 'patients'), icon: Users });
  }

  navItems.push({ id: 'notifications', label: t(language, 'notifications'), icon: Bell });

  if (isSuper || isHospitalAdmin) {
    navItems.push(
      { id: 'organization', label: t(language, 'organization'), icon: Building2 },
      { id: 'integrations', label: t(language, 'integrations'), icon: Settings2 },
      { id: 'audit', label: t(language, 'auditLogs'), icon: ShieldCheck },
      { id: 'apidocs', label: t(language, 'apiDocs'), icon: Code2 }
    );
  }

  const avatarSrc =
    user.role === 'doctor'
      ? '/src/assets/images/doctor_portrait_1794929864955.jpg'
      : user.role === 'lab_staff'
      ? '/src/assets/images/lab_specialist_portrait_1794929865091.jpg'
      : null;

  const initials = user.fullName
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  return (
    <div
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      className="min-h-screen bg-slate-50 text-slate-900 flex"
    >
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col justify-between transition-transform duration-150 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div>
          <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between">
            <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
              {t(language, 'appName')}
            </span>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1 text-slate-500"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="px-4 py-4 border-b border-slate-100">
            <div className="text-[11px] font-mono text-teal-700 uppercase">
              {user.role.replace(/_/g, ' ')}
            </div>
            <div className="text-xs font-medium text-slate-800 truncate mt-0.5">
              {hospital?.name || 'Platform Network Console'}
            </div>
          </div>

          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-teal-50 text-teal-800'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-teal-600' : 'text-slate-400'
                    }`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-200 space-y-2">
          <button
            onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            <span className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-sky-600" />
              <span>Language</span>
            </span>
            <span className="font-semibold text-teal-700">{t(language, 'languageLabel')}</span>
          </button>

          <button
            onClick={logout}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>{t(language, 'signOut')}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 truncate">
              <Activity className="w-4 h-4 text-teal-600 shrink-0 hidden sm:block" />
              <span className="truncate">
                {navItems.find((n) => n.id === activeTab)?.label || 'Workspace'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-semibold text-slate-900">{user.fullName}</div>
              <div className="text-[11px] text-slate-500 font-mono">{user.email}</div>
            </div>
            {avatarSrc && !avatarFailed ? (
              <img
                src={avatarSrc}
                alt={user.fullName}
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
                className="w-9 h-9 rounded-full object-cover border border-slate-200"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-teal-700 text-white text-xs font-semibold flex items-center justify-center">
                {initials}
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView onNavigate={(tab) => setActiveTab(tab as NavTab)} />
          )}
          {activeTab === 'reports' && <ReportsModule />}
          {activeTab === 'patients' && <PatientsModule />}
          {activeTab === 'notifications' && <NotificationsModule />}
          {activeTab === 'organization' && <PlatformAdminModule mode="organization" />}
          {activeTab === 'integrations' && <PlatformAdminModule mode="integrations" />}
          {activeTab === 'audit' && <PlatformAdminModule mode="audit" />}
          {activeTab === 'apidocs' && <PlatformAdminModule mode="apidocs" />}
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceShell />
    </AuthProvider>
  );
}
