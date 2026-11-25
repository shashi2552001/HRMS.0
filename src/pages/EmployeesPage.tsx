import React, { useCallback, useEffect, useState } from 'react';
import { Briefcase, Eye, Search } from 'lucide-react';
import { AppLayout } from '../components/Layout.tsx';
import { EmptyState, Modal, TableSkeleton } from '../components/ui/Primitives.tsx';
import { apiRequest } from '../lib/api.ts';
import { Employee } from '../shared/types.ts';

export default function EmployeesPage() {
  const [items, setItems] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('ALL');
  const [scope, setScope] = useState<'all' | 'live' | 'demo'>('all');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Employee | null>(null);

  useEffect(() => {
    apiRequest<{ config: { departments: string[] } }>('/api/config')
      .then((res) => setDepartments(res.config.departments))
      .catch(() => {});
  }, []);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ search, department: dept, scope });
      const res = await apiRequest<{ items: Employee[] }>(`/api/employees?${qs.toString()}`);
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }, [search, dept, scope]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  return (
    <AppLayout
      title="Employee Directory"
      breadcrumb="9HR India Pvt. Ltd. · Converted Onboarding Records"
    >
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Employee ID, name, email, or role..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-600"
            />
          </div>
          <select
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
          >
            <option value="ALL">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['all', 'live', 'demo'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer ${
                scope === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {s === 'all' ? 'All' : s === 'live' ? 'Live' : 'Demo'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="w-6 h-6" />}
          title="No employee records found"
          description="Approved candidates converted into employees appear here with their unique 9HR Employee ID."
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Employee ID</th>
                  <th className="py-3 px-4">Full Name</th>
                  <th className="py-3 px-4">Designation · Department</th>
                  <th className="py-3 px-4">Joining Date</th>
                  <th className="py-3 px-4">Source Candidate</th>
                  <th className="py-3 px-4 text-right">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {items.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-mono text-xs font-bold text-emerald-700 whitespace-nowrap">
                      {emp.employeeCode}
                      {emp.isDemo && (
                        <span className="ml-1.5 font-sans font-normal text-slate-400">· Demo</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{emp.fullName}</div>
                      <div className="text-xs text-slate-500">{emp.email}</div>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-medium text-slate-900">{emp.position}</div>
                      <div className="text-slate-500">{emp.department}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs tabular-nums text-slate-600">
                      {emp.joiningDate}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500">
                      {emp.candidateCode}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelected(emp)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 border border-slate-200 rounded-md hover:border-emerald-300 hover:text-emerald-700 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View Record
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.fullName} (${selected.employeeCode})` : ''}
        subtitle={selected ? `${selected.position} · ${selected.department}` : ''}
        maxWidth="max-w-2xl"
      >
        {selected && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
              <p className="font-bold text-slate-800 mb-2">Employment & Personal</p>
              <p><strong>Employee ID:</strong> <span className="font-mono">{selected.employeeCode}</span></p>
              <p><strong>Email:</strong> {selected.email}</p>
              <p><strong>Mobile:</strong> {selected.mobile}</p>
              <p><strong>Joining Date:</strong> <span className="font-mono">{selected.joiningDate}</span></p>
              <p><strong>DOB:</strong> <span className="font-mono">{selected.personalInfo.dateOfBirth}</span></p>
              <p><strong>Recruiter:</strong> {selected.assignedRecruiterName}</p>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
              <p className="font-bold text-slate-800 mb-2">Address & Emergency</p>
              <p><strong>Address:</strong> {selected.addressInfo.currentAddress}</p>
              <p><strong>City / State:</strong> {selected.addressInfo.city}, {selected.addressInfo.state} - {selected.addressInfo.pinCode}</p>
              <p><strong>Emergency Contact:</strong> {selected.familyInfo.emergencyContactName} ({selected.familyInfo.emergencyContactRelation})</p>
              <p><strong>Emergency Phone:</strong> {selected.familyInfo.emergencyContactPhone}</p>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
              <p className="font-bold text-slate-800 mb-2">Education & Prior Work</p>
              <p><strong>Qualification:</strong> {selected.educationInfo.highestQualification}</p>
              <p><strong>University:</strong> {selected.educationInfo.collegeUniversity} ({selected.educationInfo.passingYear})</p>
              <p><strong>Previous Employer:</strong> {selected.employmentInfo.isFresher ? 'Fresher' : selected.employmentInfo.previousCompany}</p>
            </div>
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
              <p className="font-bold text-slate-800 mb-2">Payroll Banking</p>
              {selected.bankDetails ? (
                <>
                  <p><strong>Account Holder:</strong> {selected.bankDetails.accountHolderName}</p>
                  <p><strong>Bank:</strong> {selected.bankDetails.bankName}</p>
                  <p><strong>Account No:</strong> <span className="font-mono">{selected.bankDetails.accountNumber}</span></p>
                  <p><strong>IFSC:</strong> <span className="font-mono">{selected.bankDetails.ifscCode}</span></p>
                </>
              ) : (
                <p className="text-slate-500">Bank details restricted for your role.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
}
