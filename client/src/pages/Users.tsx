import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../config';
import { useAuth } from '../context/AuthContext';
import { PERM } from '../permissions';
import {
  Users as UsersIcon,
  ShieldCheck,
  Plus,
  Search,
  X,
  KeyRound,
  Trash2,
  Pencil,
  CheckCircle2,
  AlertCircle,
  Lock,
} from 'lucide-react';

/**
 * Staff (employee) management.
 *
 * Two tabs over the same idea: WHO works here (Users) and WHAT each job title
 * may do (Roles). Adding an employee is "pick a role" — the role carries the
 * feature access, so the operator never has to reason about individual
 * permissions unless they want to, in which case the per-user "extra access"
 * box and the role editor are both there.
 */

interface StaffUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  jobTitle: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  extraPermissions: string[];
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string | null;
  isSelf: boolean;
  editable: boolean;
}

interface StaffRole {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  effectivePermissions: string[];
  rank: number;
  isSystem: boolean;
  userCount: number;
  editable: boolean;
}

interface PermissionDef {
  key: string;
  label: string;
  group: string;
  description?: string;
}

type Notice = { type: 'success' | 'error'; text: string } | null;

const EMPTY_FORM = {
  username: '',
  password: '',
  fullName: '',
  email: '',
  jobTitle: '',
  roleKey: '',
  status: 'active' as 'active' | 'disabled',
  permissions: [] as string[],
};

function errorText(err: unknown, fallback: string): string {
  const e = err as {
    response?: { data?: { message?: string; error?: string } };
    message?: string;
  };
  return (
    e?.response?.data?.message ??
    e?.response?.data?.error ??
    e?.message ??
    fallback
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function Users() {
  const { can, user: currentUser } = useAuth();
  const canManage = can(PERM.usersManage);

  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [catalogue, setCatalogue] = useState<PermissionDef[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<Notice>(null);

  // User modal
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<StaffUser | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Password reset modal
  const [resetFor, setResetFor] = useState<StaffUser | null>(null);
  const [newPassword, setNewPassword] = useState('');

  // Role editor
  const [editingRole, setEditingRole] = useState<StaffRole | null>(null);
  const [roleDraft, setRoleDraft] = useState<{
    key: string;
    name: string;
    description: string;
    permissions: string[];
  } | null>(null);

  const flash = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 4500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes, permsRes] = await Promise.all([
        api.get(
          `/api/users${search ? `?search=${encodeURIComponent(search)}` : ''}`,
        ),
        api.get('/api/roles'),
        api.get('/api/users/permissions'),
      ]);
      setUsers(usersRes.data.users ?? []);
      setRoles(rolesRes.data.roles ?? []);
      setCatalogue(permsRes.data.permissions ?? []);
      setGroups(permsRes.data.groups ?? []);
    } catch (err) {
      flash('error', errorText(err, 'Could not load users'));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  /** Roles this operator is allowed to hand out. */
  const assignableRoles = useMemo(
    () => roles.filter((r) => r.editable || r.key === editingUser?.roleKey),
    [roles, editingUser],
  );

  const permissionsByGroup = useMemo(() => {
    const map = new Map<string, PermissionDef[]>();
    for (const p of catalogue) {
      map.set(p.group, [...(map.get(p.group) ?? []), p]);
    }
    return map;
  }, [catalogue]);

  const openCreate = () => {
    setEditingUser(null);
    setForm({
      ...EMPTY_FORM,
      roleKey:
        assignableRoles.find((r) => r.key === 'agent')?.key ??
        assignableRoles[0]?.key ??
        '',
    });
    setShowUserModal(true);
  };

  const openEdit = (u: StaffUser) => {
    setEditingUser(u);
    setForm({
      username: u.username,
      password: '',
      fullName: u.fullName,
      email: u.email,
      jobTitle: u.jobTitle,
      roleKey: u.roleKey,
      status: u.status,
      permissions: u.extraPermissions,
    });
    setShowUserModal(true);
  };

  const saveUser = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (editingUser) {
        await api.patch(`/api/users/${editingUser.id}`, {
          roleKey: form.roleKey,
          fullName: form.fullName,
          email: form.email,
          jobTitle: form.jobTitle,
          status: form.status,
          permissions: form.permissions,
        });
        flash('success', `${form.username} updated`);
      } else {
        await api.post('/api/users', {
          username: form.username,
          password: form.password,
          roleKey: form.roleKey,
          fullName: form.fullName,
          email: form.email,
          jobTitle: form.jobTitle,
          status: form.status,
          permissions: form.permissions,
        });
        flash('success', `${form.username} added`);
      }
      setShowUserModal(false);
      await load();
    } catch (err) {
      flash('error', errorText(err, 'Could not save the user'));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (u: StaffUser) => {
    try {
      await api.patch(`/api/users/${u.id}`, {
        status: u.status === 'active' ? 'disabled' : 'active',
      });
      flash(
        'success',
        `${u.username} ${u.status === 'active' ? 'disabled' : 're-enabled'}`,
      );
      await load();
    } catch (err) {
      flash('error', errorText(err, 'Could not change the account status'));
    }
  };

  const removeUser = async (u: StaffUser) => {
    if (
      !window.confirm(
        `Delete ${u.username}? Their account is removed permanently.`,
      )
    ) {
      return;
    }
    try {
      await api.delete(`/api/users/${u.id}`);
      flash('success', `${u.username} deleted`);
      await load();
    } catch (err) {
      flash('error', errorText(err, 'Could not delete the user'));
    }
  };

  const submitReset = async () => {
    if (!resetFor) return;
    try {
      await api.post(`/api/users/${resetFor.id}/password`, {
        password: newPassword,
      });
      flash('success', `Password reset for ${resetFor.username}`);
      setResetFor(null);
      setNewPassword('');
    } catch (err) {
      flash('error', errorText(err, 'Could not reset the password'));
    }
  };

  const openRole = (r: StaffRole) => {
    setEditingRole(r);
    setRoleDraft({
      key: r.key,
      name: r.name,
      description: r.description,
      // Show the EFFECTIVE list so a wildcard role ('crm.*') renders as ticked
      // boxes the operator can reason about instead of an opaque string.
      permissions: r.effectivePermissions,
    });
  };

  const saveRole = async () => {
    if (!editingRole || !roleDraft) return;
    setSaving(true);
    try {
      await api.patch(`/api/roles/${editingRole.id}`, {
        name: roleDraft.name,
        description: roleDraft.description,
        permissions: roleDraft.permissions,
      });
      flash('success', `${roleDraft.name} updated`);
      setEditingRole(null);
      setRoleDraft(null);
      await load();
    } catch (err) {
      flash('error', errorText(err, 'Could not save the role'));
    } finally {
      setSaving(false);
    }
  };

  const togglePermission = (list: string[], key: string): string[] =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <UsersIcon className="h-6 w-6 text-blue-600" />
            Users &amp; Roles
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Add employees and give each one a role — the role decides which
            features they can open.
          </p>
        </div>
        {canManage && tab === 'users' && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition"
          >
            <Plus className="h-5 w-5" /> Add employee
          </button>
        )}
      </div>

      {notice && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm ${
            notice.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
          )}
          {notice.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {(
          [
            ['users', 'Employees', users.length],
            ['roles', 'Roles', roles.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
              tab === key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
              {count}
            </span>
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <>
          <div className="relative max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, username or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-11 pr-4 py-3 w-full bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm"
            />
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['Employee', 'Role', 'Status', 'Last login', ''].map(
                      (h, i) => (
                        <th
                          key={h || i}
                          className={`px-6 py-4 text-xs font-bold text-gray-400 uppercase ${
                            i === 4 ? 'text-right' : 'text-left'
                          }`}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-12 text-center text-gray-400"
                      >
                        Loading...
                      </td>
                    </tr>
                  ) : users.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-6 py-12 text-center text-gray-400"
                      >
                        No employees yet
                      </td>
                    </tr>
                  ) : (
                    users.map((u) => (
                      <tr key={u.id} className="hover:bg-gray-50 transition">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold uppercase">
                              {(u.fullName || u.username).charAt(0)}
                            </div>
                            <div>
                              <p className="font-medium text-gray-800">
                                {u.fullName || u.username}
                                {u.isSelf && (
                                  <span className="ml-2 text-[10px] uppercase tracking-wide bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                                    you
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-gray-500">
                                @{u.username}
                                {u.jobTitle ? ` · ${u.jobTitle}` : ''}
                                {u.email ? ` · ${u.email}` : ''}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            {u.roleName}
                          </span>
                          {u.extraPermissions.length > 0 && (
                            <span className="ml-2 text-[10px] text-gray-500">
                              +{u.extraPermissions.length} extra
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                              u.status === 'active'
                                ? 'bg-green-50 text-green-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {u.status === 'active' ? 'Active' : 'Disabled'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {formatDate(u.lastLoginAt)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-1">
                            {canManage && u.editable ? (
                              <>
                                <button
                                  onClick={() => openEdit(u)}
                                  title="Edit role & details"
                                  className="p-2 rounded-lg hover:bg-blue-50 text-blue-600"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => setResetFor(u)}
                                  title="Reset password"
                                  className="p-2 rounded-lg hover:bg-amber-50 text-amber-600"
                                >
                                  <KeyRound className="h-4 w-4" />
                                </button>
                                {!u.isSelf && (
                                  <>
                                    <button
                                      onClick={() => toggleStatus(u)}
                                      title={
                                        u.status === 'active'
                                          ? 'Disable account'
                                          : 'Re-enable account'
                                      }
                                      className="px-2.5 py-1.5 rounded-lg hover:bg-gray-100 text-xs font-medium text-gray-600"
                                    >
                                      {u.status === 'active'
                                        ? 'Disable'
                                        : 'Enable'}
                                    </button>
                                    <button
                                      onClick={() => removeUser(u)}
                                      title="Delete account"
                                      className="p-2 rounded-lg hover:bg-red-50 text-red-600"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </>
                                )}
                              </>
                            ) : (
                              <span
                                title={
                                  canManage
                                    ? 'This account is at or above your own level'
                                    : 'You do not have permission to manage users'
                                }
                                className="inline-flex items-center gap-1 text-xs text-gray-400"
                              >
                                <Lock className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'roles' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {loading ? (
            <p className="text-gray-400 text-sm">Loading...</p>
          ) : (
            roles.map((r) => (
              <div
                key={r.id}
                className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-gray-800 flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-indigo-600" />
                      {r.name}
                      {r.isSystem && (
                        <span className="text-[10px] uppercase tracking-wide bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                          built-in
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-gray-500 mt-1">
                      {r.description}
                    </p>
                  </div>
                  {canManage && r.editable && r.key !== 'super_admin' && (
                    <button
                      onClick={() => openRole(r)}
                      className="px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 flex-shrink-0"
                    >
                      Edit access
                    </button>
                  )}
                </div>
                <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
                  <span>
                    <strong className="text-gray-700">
                      {r.effectivePermissions.length}
                    </strong>{' '}
                    permissions
                  </span>
                  <span>
                    <strong className="text-gray-700">{r.userCount}</strong>{' '}
                    {r.userCount === 1 ? 'employee' : 'employees'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Add / edit employee ─────────────────────────────────────────── */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-800">
                {editingUser ? `Edit ${editingUser.username}` : 'Add employee'}
              </h3>
              <button
                onClick={() => setShowUserModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    Username *
                  </label>
                  <input
                    type="text"
                    value={form.username}
                    disabled={Boolean(editingUser)}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, username: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-50 disabled:text-gray-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    Full name
                  </label>
                  <input
                    type="text"
                    value={form.fullName}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, fullName: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, email: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    Job title
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Sales Executive"
                    value={form.jobTitle}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, jobTitle: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              {!editingUser && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    Password *
                  </label>
                  <input
                    type="password"
                    value={form.password}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, password: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    At least 12 characters, with an uppercase letter, a
                    lowercase letter and a digit.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    Role *
                  </label>
                  <select
                    value={form.roleKey}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, roleKey: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {assignableRoles.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {roles.find((r) => r.key === form.roleKey)?.description ??
                      ''}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        status: e.target.value as 'active' | 'disabled',
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
              </div>

              {/* Extra grants on top of the role */}
              <details className="rounded-xl border border-gray-200">
                <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer">
                  Extra access beyond the role
                  {form.permissions.length > 0 && (
                    <span className="ml-2 text-xs text-blue-600">
                      {form.permissions.length} selected
                    </span>
                  )}
                </summary>
                <div className="px-4 pb-4 space-y-3 max-h-64 overflow-y-auto">
                  <p className="text-[11px] text-gray-400">
                    Only tick these when one person needs something their role
                    doesn&apos;t cover. You can only grant access you hold
                    yourself.
                  </p>
                  {groups.map((group) => (
                    <div key={group}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">
                        {group}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {(permissionsByGroup.get(group) ?? []).map((p) => (
                          <label
                            key={p.key}
                            className="flex items-start gap-2 text-xs text-gray-600 py-0.5"
                          >
                            <input
                              type="checkbox"
                              checked={form.permissions.includes(p.key)}
                              onChange={() =>
                                setForm((f) => ({
                                  ...f,
                                  permissions: togglePermission(
                                    f.permissions,
                                    p.key,
                                  ),
                                }))
                              }
                              className="mt-0.5"
                            />
                            <span>{p.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>

            <div className="p-5 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => setShowUserModal(false)}
                className="flex-1 px-4 py-3 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveUser}
                disabled={
                  saving ||
                  !form.roleKey ||
                  (!editingUser && (!form.username || !form.password))
                }
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving
                  ? 'Saving…'
                  : editingUser
                    ? 'Save changes'
                    : 'Add employee'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Password reset ──────────────────────────────────────────────── */}
      {resetFor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-800">Reset password</h3>
            <p className="text-sm text-gray-500 mt-1">
              Set a new password for <strong>{resetFor.username}</strong> and
              share it with them directly.
            </p>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              className="mt-4 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              At least 12 characters, with upper, lower and a digit.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => {
                  setResetFor(null);
                  setNewPassword('');
                }}
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={submitReset}
                disabled={!newPassword}
                className="flex-1 px-4 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Role permission editor ──────────────────────────────────────── */}
      {editingRole && roleDraft && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-800">
                  {roleDraft.name}
                </h3>
                <p className="text-xs text-gray-500">
                  Tick what this role can open. {editingRole.userCount}{' '}
                  {editingRole.userCount === 1
                    ? 'employee has'
                    : 'employees have'}{' '}
                  this role.
                </p>
              </div>
              <button
                onClick={() => {
                  setEditingRole(null);
                  setRoleDraft(null);
                }}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    Role name
                  </label>
                  <input
                    type="text"
                    value={roleDraft.name}
                    onChange={(e) =>
                      setRoleDraft((d) => d && { ...d, name: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={roleDraft.description}
                    onChange={(e) =>
                      setRoleDraft(
                        (d) => d && { ...d, description: e.target.value },
                      )
                    }
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              {groups.map((group) => {
                const items = permissionsByGroup.get(group) ?? [];
                const allOn = items.every((p) =>
                  roleDraft.permissions.includes(p.key),
                );
                return (
                  <div
                    key={group}
                    className="rounded-xl border border-gray-200 p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                        {group}
                      </p>
                      <button
                        onClick={() =>
                          setRoleDraft(
                            (d) =>
                              d && {
                                ...d,
                                permissions: allOn
                                  ? d.permissions.filter(
                                      (k) => !items.some((p) => p.key === k),
                                    )
                                  : [
                                      ...new Set([
                                        ...d.permissions,
                                        ...items.map((p) => p.key),
                                      ]),
                                    ],
                              },
                          )
                        }
                        className="text-[11px] text-blue-600 hover:underline"
                      >
                        {allOn ? 'Clear all' : 'Select all'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {items.map((p) => (
                        <label
                          key={p.key}
                          className="flex items-start gap-2 text-xs text-gray-600"
                          title={p.description}
                        >
                          <input
                            type="checkbox"
                            checked={roleDraft.permissions.includes(p.key)}
                            onChange={() =>
                              setRoleDraft(
                                (d) =>
                                  d && {
                                    ...d,
                                    permissions: togglePermission(
                                      d.permissions,
                                      p.key,
                                    ),
                                  },
                              )
                            }
                            className="mt-0.5"
                          />
                          <span>{p.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-5 border-t border-gray-100 flex gap-3">
              <button
                onClick={() => {
                  setEditingRole(null);
                  setRoleDraft(null);
                }}
                className="flex-1 px-4 py-3 border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveRole}
                disabled={saving}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!canManage && (
        <p className="text-xs text-gray-400">
          You&apos;re signed in as {currentUser?.username} with read-only access
          to this page.
        </p>
      )}
    </div>
  );
}
