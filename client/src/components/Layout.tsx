import { useState, memo } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BRAND } from '../brand';
import {
  LayoutDashboard,
  Database,
  Settings,
  LogOut,
  Smartphone,
  Menu,
  X,
  Globe,
  AudioLines,
  Megaphone,
  Briefcase,
  MessageSquare,
  FileText,
  Calendar,
  UserCheck,
  ChevronDown,
  ChevronRight,
  Cpu,
  Bot,
  Inbox,
  Search,
  Radio,
  Users,
  LineChart,
  Building2,
  Wand2,
  ShieldAlert,
  Headphones,
  UsersRound,
} from 'lucide-react';
import { PERM, type PermissionKey } from '../permissions';

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: string;
  badgeColor?: string;
  /**
   * Permission that unlocks this entry. An item with no `permission` is
   * visible to every signed-in account. The link is only a UX affordance —
   * the same permission gates the API, so hiding it is not the boundary.
   */
  permission?: PermissionKey;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        to: '/dashboard',
        icon: LayoutDashboard,
        label: 'Dashboard',
        permission: PERM.dashboard,
      },
    ],
  },
  {
    title: 'Communication',
    items: [
      {
        to: '/chat',
        icon: MessageSquare,
        label: 'Live Chat',
        permission: PERM.chatView,
      },
      {
        to: '/sessions',
        icon: Smartphone,
        label: 'Linked Devices',
        permission: PERM.sessionsView,
      },
      {
        to: '/bulk-message',
        icon: Megaphone,
        label: 'Bulk Messaging',
        permission: PERM.bulkSend,
      },
    ],
  },
  {
    title: 'CRM & Sales',
    items: [
      { to: '/crm', icon: Briefcase, label: 'CRM', permission: PERM.crmView },
      {
        to: '/follow-up',
        icon: UserCheck,
        label: 'Follow-up Manager',
        permission: PERM.followup,
      },
      {
        to: '/consulting-assistant',
        icon: Headphones,
        label: 'Consulting Assistant AI',
        permission: PERM.consulting,
      },
      {
        to: '/calendar',
        icon: Calendar,
        label: 'Calendar',
        permission: PERM.calendar,
      },
    ],
  },
  {
    title: 'AI & Automation',
    items: [
      {
        to: '/voice-agent-hub',
        icon: AudioLines,
        label: 'Voice Agent',
        permission: PERM.voiceView,
      },
      {
        to: '/form-builder',
        icon: FileText,
        label: 'Form Builder',
        permission: PERM.forms,
      },
      {
        to: '/datasets',
        icon: Database,
        label: 'Datasets',
        permission: PERM.datasets,
      },
      {
        to: '/webhooks',
        icon: Globe,
        label: 'Webhooks',
        permission: PERM.webhooks,
      },
    ],
  },
  {
    title: 'Agents',
    items: [
      {
        to: '/agents',
        icon: Bot,
        label: 'Agents Hub',
        permission: PERM.agentsView,
      },
      {
        to: '/agents/approvals',
        icon: Inbox,
        label: 'Approval Queue',
        permission: PERM.agentsApprove,
      },
      {
        to: '/agents/traces',
        icon: Search,
        label: 'Traces',
        permission: PERM.agentsView,
      },
    ],
  },
  {
    title: 'Marketing',
    items: [
      {
        to: '/channels',
        icon: Radio,
        label: 'Channels',
        permission: PERM.channels,
      },
      {
        to: '/campaigns',
        icon: Megaphone,
        label: 'Campaigns',
        permission: PERM.campaignsView,
      },
      {
        to: '/segments',
        icon: Users,
        label: 'Segments',
        permission: PERM.segments,
      },
      {
        to: '/content-studio',
        icon: Wand2,
        label: 'Content Studio',
        permission: PERM.content,
      },
      {
        to: '/marketing-insights',
        icon: LineChart,
        label: 'Insights',
        permission: PERM.insights,
      },
    ],
  },
  {
    title: 'System',
    items: [
      {
        to: '/users',
        icon: UsersRound,
        label: 'Users & Roles',
        permission: PERM.usersView,
      },
      {
        to: '/tenants',
        icon: Building2,
        label: 'Tenants',
        permission: PERM.tenants,
      },
      {
        to: '/audit',
        icon: ShieldAlert,
        label: 'Audit Log',
        permission: PERM.audit,
      },
      {
        to: '/config',
        icon: Settings,
        label: 'Configuration',
        permission: PERM.config,
      },
      {
        to: '/system',
        icon: Cpu,
        label: 'System Health',
        permission: PERM.system,
      },
    ],
  },
];

interface NavLinkProps {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: string;
  badgeColor?: string;
  isActive: boolean;
  onClick: () => void;
}

const NavLink = memo(function NavLink({
  to,
  icon: Icon,
  label,
  badge,
  badgeColor,
  isActive,
  onClick,
}: NavLinkProps) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`group flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
        isActive
          ? 'bg-green-600 text-white shadow-sm shadow-green-900/30'
          : 'text-gray-300 hover:bg-gray-700 hover:text-white'
      }`}
    >
      <Icon
        className={`mr-3 h-4.5 w-4.5 flex-shrink-0 ${
          isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'
        }`}
      />
      <span className="truncate flex-1">{label}</span>
      {badge && (
        <span
          className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
            badgeColor || 'bg-green-500 text-white'
          }`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
});

interface SectionProps {
  section: NavSection;
  activePath: string;
  closeSidebar: () => void;
  isCollapsed: boolean;
  onToggle: () => void;
}

const NavSection = memo(function NavSection({
  section,
  activePath,
  closeSidebar,
  isCollapsed,
  onToggle,
}: SectionProps) {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full px-3 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-widest hover:text-gray-400 transition-colors"
      >
        <span>{section.title}</span>
        {isCollapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>
      {!isCollapsed && (
        <div className="space-y-0.5 mt-0.5">
          {section.items.map((item) => (
            <NavLink
              key={item.to}
              {...item}
              isActive={activePath === item.to}
              onClick={closeSidebar}
            />
          ))}
        </div>
      )}
    </div>
  );
});

export default function Layout() {
  const { logout, can, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const closeSidebar = () => setIsSidebarOpen(false);

  const toggleSection = (title: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const activePath = location.pathname;

  // Hide what this account can't reach. While /me is still in flight we show
  // nothing rather than everything — flashing links the user is about to lose
  // reads as a bug, and the wait is one request long.
  const visibleSections = loading
    ? []
    : NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => !item.permission || can(item.permission),
        ),
      })).filter((section) => section.items.length > 0);

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 w-full bg-gray-900 text-white z-50 px-4 h-14 flex items-center justify-between shadow-lg border-b border-gray-700">
        <div className="flex items-center">
          <img src={BRAND.logo} alt={BRAND.name} className="h-8" />
        </div>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 rounded-lg hover:bg-gray-700 transition-colors"
        >
          {isSidebarOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={`
        fixed md:static inset-y-0 left-0 z-40 w-60 bg-gray-900 text-gray-100 flex flex-col
        transition-transform duration-300 ease-in-out
        ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }
        shadow-xl md:shadow-none
      `}
      >
        {/* Logo */}
        <div className="hidden md:flex h-16 items-center px-4 border-b border-gray-700/50">
          <img src={BRAND.logo} alt={BRAND.name} className="h-10" />
          <div className="ml-2">
            <div className="text-xs text-gray-400 leading-tight font-medium">
              {BRAND.product}
            </div>
          </div>
        </div>

        {/* Mobile header space */}
        <div className="md:hidden h-14 border-b border-gray-700/50 flex items-center px-4">
          <img src={BRAND.logo} alt={BRAND.name} className="h-8" />
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-3 px-2 space-y-2 scrollbar-thin scrollbar-thumb-gray-700">
          {visibleSections.map((section) => (
            <NavSection
              key={section.title}
              section={section}
              activePath={activePath}
              closeSidebar={closeSidebar}
              isCollapsed={collapsedSections.has(section.title)}
              onToggle={() => toggleSection(section.title)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-gray-700/50">
          <button
            onClick={handleLogout}
            className="flex items-center w-full px-3 py-2.5 rounded-lg text-sm text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
          >
            <LogOut className="mr-3 h-4 w-4 flex-shrink-0" />
            <span>Sign Out</span>
          </button>
          <div className="mt-2 px-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
              <span className="text-[10px] text-gray-500">System Online</span>
            </div>
            <span className="text-[10px] text-gray-600">v0.8.0</span>
          </div>
        </div>
      </aside>

      {/* Overlay for mobile */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-30 md:hidden backdrop-blur-sm"
          onClick={closeSidebar}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto w-full pt-14 md:pt-0">
        <div className="p-4 md:p-6 min-h-full">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
